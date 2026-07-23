import type { CheckId, Severity } from '@handrail/schemas';
import type { KnownScId } from '@handrail/wcag';

/**
 * The claim families the batched text judge is allowed to raise.
 *
 * The list is closed on purpose. A model asked an open question about
 * accessibility will happily invent a criterion; a model asked nine specific
 * questions can only answer those nine, and every answer has a deterministic
 * re-check waiting for it in the verdict pipeline. Anything outside this set is
 * rejected before it reaches grounding.
 */
export const CLAIM_FAMILIES = [
  'link-purpose',
  'label-quality',
  'heading-quality',
  'heading-outline',
  'page-title',
  'error-message',
  'error-suggestion',
  'lang-of-parts',
  'alt-text-triage',
] as const;
export type ClaimFamily = (typeof CLAIM_FAMILIES)[number];

export interface ClaimFamilySpec {
  family: ClaimFamily;
  /** The check id reported on the finding. Every one is declared in `@handrail/wcag`. */
  checkId: CheckId;
  sc: readonly KnownScId[];
  defaultSeverity: Severity;
  /** The question the judge answers for this family, quoted into the system prompt. */
  question: string;
  /** What the judge must anchor the claim to, quoted into the system prompt. */
  anchor: string;
}

function spec(value: ClaimFamilySpec): ClaimFamilySpec {
  return value;
}

export const CLAIM_FAMILY_SPECS: Record<ClaimFamily, ClaimFamilySpec> = {
  'link-purpose': spec({
    family: 'link-purpose',
    checkId: 'ai.link-purpose',
    sc: ['2.4.4'],
    defaultSeverity: 'moderate',
    question:
      'Read the link\'s accessible name on its own, as a screen reader\'s link list presents it. Does it identify where the link goes?',
    anchor: 'the link element itself',
  }),
  'label-quality': spec({
    family: 'label-quality',
    checkId: 'ai.label-quality',
    sc: ['3.3.2'],
    defaultSeverity: 'serious',
    question:
      'Does the form control have a persistent label? A placeholder is not one: it disappears the moment the user types.',
    anchor: 'the form control element',
  }),
  'heading-quality': spec({
    family: 'heading-quality',
    checkId: 'ai.heading-quality',
    sc: ['2.4.6'],
    defaultSeverity: 'minor',
    question: 'Does the heading describe the section it introduces, read on its own?',
    anchor: 'the heading element',
  }),
  'heading-outline': spec({
    family: 'heading-outline',
    checkId: 'ai.heading-outline',
    sc: ['1.3.1'],
    defaultSeverity: 'minor',
    question:
      'Does the heading level sequence skip a level, so the outline a screen-reader user navigates by has a hole in it?',
    anchor: 'the heading that skips a level (the deeper one)',
  }),
  'page-title': spec({
    family: 'page-title',
    checkId: 'ai.page-title',
    sc: ['2.4.2'],
    defaultSeverity: 'moderate',
    question:
      'Read out of context, does the document title identify this page — not merely the site?',
    anchor: 'the html element',
  }),
  'error-message': spec({
    family: 'error-message',
    checkId: 'ai.error-messages',
    sc: ['3.3.1'],
    defaultSeverity: 'serious',
    question:
      'Is the input error described in text and associated with the field it belongs to, rather than signalled only visually?',
    anchor: 'the field in error, or the element carrying the error text',
  }),
  'error-suggestion': spec({
    family: 'error-suggestion',
    checkId: 'ai.error-suggestion',
    sc: ['3.3.3'],
    defaultSeverity: 'moderate',
    question: 'Does the error message say what would be valid, rather than only that something is wrong?',
    anchor: 'the element carrying the error text',
  }),
  'lang-of-parts': spec({
    family: 'lang-of-parts',
    checkId: 'ai.lang-of-parts',
    sc: ['3.1.2'],
    defaultSeverity: 'moderate',
    question:
      'Is this passage in a different language from the page default without its own lang attribute? Proper nouns and naturalised terms do not count.',
    anchor: 'the element containing the passage',
  }),
  'alt-text-triage': spec({
    family: 'alt-text-triage',
    checkId: 'ai.alt-text-triage',
    sc: ['1.1.1'],
    defaultSeverity: 'serious',
    question:
      'Judging from the text alone, is the alt attribute a non-alternative — a filename, a bare "image"/"photo"/"graphic", or a duplicate of adjacent text? Do not guess whether it matches the picture; that is the vision judge\'s job.',
    anchor: 'the img element',
  }),
};

export function isClaimFamily(value: string): value is ClaimFamily {
  return (CLAIM_FAMILIES as readonly string[]).includes(value);
}
