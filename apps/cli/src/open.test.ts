import { describe, expect, it, vi } from 'vitest';

import { openInBrowser, openerFor } from './open.js';

describe('opening the report', () => {
  it('picks the opener the platform actually has', () => {
    expect(openerFor('darwin')).toEqual({ file: 'open', args: [] });
    expect(openerFor('linux')).toEqual({ file: 'xdg-open', args: [] });
    // `start` is a cmd builtin and the empty string is the window title it would
    // otherwise take the path for.
    expect(openerFor('win32')).toEqual({ file: 'cmd', args: ['/c', 'start', ''] });
  });

  it('never spells out an executable extension — that is execa’s job', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(openerFor(platform).file).not.toMatch(/\.(cmd|exe|bat)$/);
    }
  });

  it('passes the target through as the last argument', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await openInBrowser('/tmp/report.html', { platform: 'win32', run });
    expect(run).toHaveBeenCalledWith('cmd', ['/c', 'start', '', '/tmp/report.html']);
  });
});
