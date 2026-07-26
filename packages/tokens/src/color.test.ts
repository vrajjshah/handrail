import { describe, expect, it } from 'vitest';

import {
  CONTRAST_THRESHOLDS,
  contrastRatio,
  hueAngle,
  hueDistance,
  meetsContrast,
  parseHex,
  relativeLuminance,
} from './color.js';

describe('parseHex', () => {
  it('reads a #rrggbb colour', () => {
    expect(parseHex('#0b5560')).toEqual({ r: 0x0b, g: 0x55, b: 0x60 });
  });

  it('is case-insensitive', () => {
    expect(parseHex('#0B5560')).toEqual(parseHex('#0b5560'));
  });

  it.each(['0b5560', '#abc', '#gggggg', '#0b556080', 'rebeccapurple'])(
    'rejects %s',
    (value) => {
      expect(() => parseHex(value)).toThrow(/expected a #rrggbb colour/);
    },
  );
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('applies the sRGB transfer curve rather than a linear ramp', () => {
    // Mid-grey is perceptually half, not numerically half: a linear reading
    // would give 0.5 and would quietly overstate every ratio computed from it.
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#0b5560', '#0b5560')).toBe(1);
  });

  it('does not depend on the order of the arguments', () => {
    expect(contrastRatio('#54606e', '#ffffff')).toBe(contrastRatio('#ffffff', '#54606e'));
  });

  it('agrees with the worked example in Understanding SC 1.4.3', () => {
    // #767676 on white is the canonical "exactly passes AA body text" pair.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});

describe('hueAngle', () => {
  it('places the primaries where they belong on the wheel', () => {
    expect(hueAngle('#ff0000')).toBeCloseTo(0, 5);
    expect(hueAngle('#00ff00')).toBeCloseTo(120, 5);
    expect(hueAngle('#0000ff')).toBeCloseTo(240, 5);
  });

  it('reports 0 for a grey rather than an arbitrary angle', () => {
    expect(hueAngle('#808080')).toBe(0);
    expect(hueAngle('#ffffff')).toBe(0);
  });
});

describe('hueDistance', () => {
  it('takes the short way round the wheel', () => {
    // 350° and 10° are 20° apart, not 340°.
    expect(hueDistance('#ff0055', '#ff5500')).toBeLessThan(60);
    expect(hueDistance('#ff0000', '#00ffff')).toBe(180);
  });

  it('is symmetric', () => {
    expect(hueDistance('#0b5560', '#6b2fb5')).toBe(hueDistance('#6b2fb5', '#0b5560'));
  });

  it('is the measure contrast cannot give: two colours can be legible and alike', () => {
    // The accent teal and the AI violet, which is where this function came from.
    expect(contrastRatio('#0b5560', '#6b2fb5')).toBeLessThan(1.2);
    expect(hueDistance('#0b5560', '#6b2fb5')).toBeGreaterThan(45);
  });
});

describe('meetsContrast', () => {
  it('holds text to 4.5 and non-text to 3', () => {
    expect(CONTRAST_THRESHOLDS.text).toBe(4.5);
    expect(CONTRAST_THRESHOLDS['non-text']).toBe(3);
    expect(CONTRAST_THRESHOLDS['large-text']).toBe(3);
  });

  it('accepts a pair that clears its threshold and rejects one that does not', () => {
    expect(meetsContrast('#767676', '#ffffff', 'text')).toBe(true);
    expect(meetsContrast('#8d8d8d', '#ffffff', 'text')).toBe(false);
    expect(meetsContrast('#8d8d8d', '#ffffff', 'non-text')).toBe(true);
  });
});
