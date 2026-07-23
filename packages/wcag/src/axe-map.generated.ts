// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Regenerate with: pnpm --filter @handrail/wcag axe-map
//
// Built from axe-core 4.12.1 via axe.getRules(). The stamp below is
// asserted in axe.test.ts: if the installed axe version moves, or any rule's WCAG
// tagging changes, the test fails and this file must be regenerated deliberately.

import type { AxeMap } from './axe-mapping.js';

export const AXE_MAP: AxeMap = {
  "stamp": {
    "axeVersion": "4.12.1",
    "ruleCount": 105,
    "mappedRuleCount": 70,
    "criteriaWithAxeCoverage": 23
  },
  "rules": [
    {
      "ruleId": "area-alt",
      "sc": [
        "2.4.4",
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Active <area> elements must have alternative text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/area-alt?application=axeAPI",
      "tags": [
        "ACT",
        "cat.text-alternatives",
        "EN-301-549",
        "EN-9.2.4.4",
        "EN-9.4.1.2",
        "RGAA-1.1.2",
        "RGAAv4",
        "section508",
        "section508.22.a",
        "TT6.a",
        "TTv5",
        "wcag244",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-allowed-attr",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Elements must only use supported ARIA attributes",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-allowed-attr?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-7.1.1",
        "RGAAv4",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-braille-equivalent",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "aria-braille attributes must have a non-braille equivalent",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-braille-equivalent?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-command-name",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "ARIA commands must have an accessible name",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-command-name?application=axeAPI",
      "tags": [
        "ACT",
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-11.9.1",
        "RGAAv4",
        "TT6.a",
        "TTv5",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-conditional-attr",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "ARIA attributes must be used as specified for the element's role",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-conditional-attr?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-7.1.1",
        "RGAAv4",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-deprecated-role",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Deprecated ARIA roles must not be used",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-deprecated-role?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-7.1.1",
        "RGAAv4",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-hidden-body",
      "sc": [
        "1.3.1",
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "aria-hidden=\"true\" must not be present on the document body",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-hidden-body?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.1.3.1",
        "EN-9.4.1.2",
        "RGAA-10.8.1",
        "RGAAv4",
        "wcag131",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-hidden-focus",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "ARIA hidden element must not be focusable or contain focusable elements",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-hidden-focus?application=axeAPI",
      "tags": [
        "cat.name-role-value",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-10.8.1",
        "RGAAv4",
        "TT6.a",
        "TTv5",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-input-field-name",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "ARIA input fields must have an accessible name",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-input-field-name?application=axeAPI",
      "tags": [
        "ACT",
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-11.1.1",
        "RGAAv4",
        "TT5.c",
        "TTv5",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-meter-name",
      "sc": [
        "1.1.1"
      ],
      "outOfScopeSc": [],
      "help": "ARIA meter nodes must have an accessible name",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-meter-name?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.1.1.1",
        "RGAA-11.1.1",
        "RGAAv4",
        "wcag111",
        "wcag2a"
      ]
    },
    {
      "ruleId": "aria-progressbar-name",
      "sc": [
        "1.1.1"
      ],
      "outOfScopeSc": [],
      "help": "ARIA progressbar nodes must have an accessible name",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-progressbar-name?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.1.1.1",
        "RGAA-11.1.1",
        "RGAAv4",
        "wcag111",
        "wcag2a"
      ]
    },
    {
      "ruleId": "aria-prohibited-attr",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Elements must only use permitted ARIA attributes",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-prohibited-attr?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-7.1.1",
        "RGAAv4",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-required-attr",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Required ARIA attributes must be provided",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-required-attr?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-7.1.1",
        "RGAAv4",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-required-children",
      "sc": [
        "1.3.1"
      ],
      "outOfScopeSc": [],
      "help": "Certain ARIA roles must contain particular children",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-required-children?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.1.3.1",
        "RGAA-9.3.1",
        "RGAAv4",
        "wcag131",
        "wcag2a"
      ]
    },
    {
      "ruleId": "aria-required-parent",
      "sc": [
        "1.3.1"
      ],
      "outOfScopeSc": [],
      "help": "Certain ARIA roles must be contained by particular parents",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-required-parent?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.1.3.1",
        "RGAA-9.3.1",
        "RGAAv4",
        "wcag131",
        "wcag2a"
      ]
    },
    {
      "ruleId": "aria-roledescription",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "aria-roledescription must be on elements with a semantic role",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-roledescription?application=axeAPI",
      "tags": [
        "cat.aria",
        "deprecated",
        "EN-301-549",
        "EN-9.4.1.2",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-roles",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "ARIA roles used must conform to valid values",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-roles?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-7.1.1",
        "RGAAv4",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-tab-name",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "ARIA tab nodes must have an accessible name",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-tab-name?application=axeAPI",
      "tags": [
        "ACT",
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-7.1.1",
        "RGAAv4",
        "TT5.c",
        "TTv5",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-toggle-field-name",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "ARIA toggle fields must have an accessible name",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-toggle-field-name?application=axeAPI",
      "tags": [
        "ACT",
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-7.1.1",
        "RGAAv4",
        "TT5.c",
        "TTv5",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-tooltip-name",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "ARIA tooltip nodes must have an accessible name",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-tooltip-name?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-valid-attr",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "ARIA attributes must conform to valid names",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-valid-attr?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-7.1.1",
        "RGAAv4",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "aria-valid-attr-value",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "ARIA attributes must conform to valid values",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/aria-valid-attr-value?application=axeAPI",
      "tags": [
        "cat.aria",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-7.1.1",
        "RGAAv4",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "audio-caption",
      "sc": [
        "1.2.1"
      ],
      "outOfScopeSc": [],
      "help": "<audio> elements must have a captions track",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/audio-caption?application=axeAPI",
      "tags": [
        "cat.time-and-media",
        "deprecated",
        "EN-301-549",
        "EN-9.1.2.1",
        "section508",
        "section508.22.a",
        "wcag121",
        "wcag2a"
      ]
    },
    {
      "ruleId": "autocomplete-valid",
      "sc": [
        "1.3.5"
      ],
      "outOfScopeSc": [],
      "help": "autocomplete attribute must be used correctly",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/autocomplete-valid?application=axeAPI",
      "tags": [
        "ACT",
        "cat.forms",
        "EN-301-549",
        "EN-9.1.3.5",
        "RGAA-11.13.1",
        "RGAAv4",
        "wcag135",
        "wcag21aa"
      ]
    },
    {
      "ruleId": "avoid-inline-spacing",
      "sc": [
        "1.4.12"
      ],
      "outOfScopeSc": [],
      "help": "Inline text spacing must be adjustable with custom stylesheets",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/avoid-inline-spacing?application=axeAPI",
      "tags": [
        "ACT",
        "cat.structure",
        "EN-301-549",
        "EN-9.1.4.12",
        "wcag1412",
        "wcag21aa"
      ]
    },
    {
      "ruleId": "blink",
      "sc": [
        "2.2.2"
      ],
      "outOfScopeSc": [],
      "help": "<blink> elements are deprecated and must not be used",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/blink?application=axeAPI",
      "tags": [
        "cat.time-and-media",
        "EN-301-549",
        "EN-9.2.2.2",
        "RGAA-13.8.1",
        "RGAAv4",
        "section508",
        "section508.22.j",
        "TT2.b",
        "TTv5",
        "wcag222",
        "wcag2a"
      ]
    },
    {
      "ruleId": "button-name",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Buttons must have discernible text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/button-name?application=axeAPI",
      "tags": [
        "ACT",
        "cat.name-role-value",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-11.9.1",
        "RGAAv4",
        "section508",
        "section508.22.a",
        "TT6.a",
        "TTv5",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "bypass",
      "sc": [
        "2.4.1"
      ],
      "outOfScopeSc": [],
      "help": "Page must have means to bypass repeated blocks",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/bypass?application=axeAPI",
      "tags": [
        "cat.keyboard",
        "EN-301-549",
        "EN-9.2.4.1",
        "RGAA-12.7.1",
        "RGAAv4",
        "section508",
        "section508.22.o",
        "TT9.a",
        "TTv5",
        "wcag241",
        "wcag2a"
      ]
    },
    {
      "ruleId": "color-contrast",
      "sc": [
        "1.4.3"
      ],
      "outOfScopeSc": [],
      "help": "Elements must meet minimum color contrast ratio thresholds",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=axeAPI",
      "tags": [
        "ACT",
        "cat.color",
        "EN-301-549",
        "EN-9.1.4.3",
        "RGAA-3.2.1",
        "RGAAv4",
        "TT13.c",
        "TTv5",
        "wcag143",
        "wcag2aa"
      ]
    },
    {
      "ruleId": "color-contrast-enhanced",
      "sc": [],
      "outOfScopeSc": [
        "1.4.6"
      ],
      "help": "Elements must meet enhanced color contrast ratio thresholds",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/color-contrast-enhanced?application=axeAPI",
      "tags": [
        "ACT",
        "cat.color",
        "wcag146",
        "wcag2aaa"
      ]
    },
    {
      "ruleId": "css-orientation-lock",
      "sc": [
        "1.3.4"
      ],
      "outOfScopeSc": [],
      "help": "CSS Media queries must not lock display orientation",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/css-orientation-lock?application=axeAPI",
      "tags": [
        "cat.structure",
        "EN-301-549",
        "EN-9.1.3.4",
        "experimental",
        "RGAA-13.9.1",
        "RGAAv4",
        "wcag134",
        "wcag21aa"
      ]
    },
    {
      "ruleId": "definition-list",
      "sc": [
        "1.3.1"
      ],
      "outOfScopeSc": [],
      "help": "<dl> elements must only directly contain properly-ordered <dt> and <dd> groups, <script>, <template> or <div> elements",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/definition-list?application=axeAPI",
      "tags": [
        "cat.structure",
        "EN-301-549",
        "EN-9.1.3.1",
        "RGAA-9.3.3",
        "RGAAv4",
        "wcag131",
        "wcag2a"
      ]
    },
    {
      "ruleId": "dlitem",
      "sc": [
        "1.3.1"
      ],
      "outOfScopeSc": [],
      "help": "<dt> and <dd> elements must be contained by a <dl>",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/dlitem?application=axeAPI",
      "tags": [
        "cat.structure",
        "EN-301-549",
        "EN-9.1.3.1",
        "RGAA-9.3.3",
        "RGAAv4",
        "wcag131",
        "wcag2a"
      ]
    },
    {
      "ruleId": "document-title",
      "sc": [
        "2.4.2"
      ],
      "outOfScopeSc": [],
      "help": "Documents must have <title> element to aid in navigation",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/document-title?application=axeAPI",
      "tags": [
        "ACT",
        "cat.text-alternatives",
        "EN-301-549",
        "EN-9.2.4.2",
        "RGAA-8.5.1",
        "RGAAv4",
        "TT12.a",
        "TTv5",
        "wcag242",
        "wcag2a"
      ]
    },
    {
      "ruleId": "duplicate-id",
      "sc": [],
      "outOfScopeSc": [
        "4.1.1"
      ],
      "help": "id attribute value must be unique",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/duplicate-id?application=axeAPI",
      "tags": [
        "cat.parsing",
        "deprecated",
        "wcag2a-obsolete",
        "wcag411"
      ]
    },
    {
      "ruleId": "duplicate-id-active",
      "sc": [],
      "outOfScopeSc": [
        "4.1.1"
      ],
      "help": "IDs of active elements must be unique",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/duplicate-id-active?application=axeAPI",
      "tags": [
        "cat.parsing",
        "deprecated",
        "wcag2a-obsolete",
        "wcag411"
      ]
    },
    {
      "ruleId": "duplicate-id-aria",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "IDs used in ARIA and labels must be unique",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/duplicate-id-aria?application=axeAPI",
      "tags": [
        "cat.parsing",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-8.2.1",
        "RGAAv4",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "form-field-multiple-labels",
      "sc": [
        "3.3.2"
      ],
      "outOfScopeSc": [],
      "help": "Form field must not have multiple label elements",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/form-field-multiple-labels?application=axeAPI",
      "tags": [
        "cat.forms",
        "EN-301-549",
        "EN-9.3.3.2",
        "RGAA-11.2.1",
        "RGAAv4",
        "TT5.c",
        "TTv5",
        "wcag2a",
        "wcag332"
      ]
    },
    {
      "ruleId": "frame-focusable-content",
      "sc": [
        "2.1.1"
      ],
      "outOfScopeSc": [],
      "help": "Frames with focusable content must not have tabindex=-1",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/frame-focusable-content?application=axeAPI",
      "tags": [
        "cat.keyboard",
        "EN-301-549",
        "EN-9.2.1.1",
        "RGAA-7.3.2",
        "RGAAv4",
        "TT4.a",
        "TTv5",
        "wcag211",
        "wcag2a"
      ]
    },
    {
      "ruleId": "frame-title",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Frames must have an accessible name",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/frame-title?application=axeAPI",
      "tags": [
        "cat.text-alternatives",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-2.1.1",
        "RGAAv4",
        "section508",
        "section508.22.i",
        "TT12.d",
        "TTv5",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "frame-title-unique",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Frames must have a unique title attribute",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/frame-title-unique?application=axeAPI",
      "tags": [
        "cat.text-alternatives",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-2.2.1",
        "RGAAv4",
        "TT12.d",
        "TTv5",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "html-has-lang",
      "sc": [
        "3.1.1"
      ],
      "outOfScopeSc": [],
      "help": "<html> element must have a lang attribute",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/html-has-lang?application=axeAPI",
      "tags": [
        "ACT",
        "cat.language",
        "EN-301-549",
        "EN-9.3.1.1",
        "RGAA-8.3.1",
        "RGAAv4",
        "TT11.a",
        "TTv5",
        "wcag2a",
        "wcag311"
      ]
    },
    {
      "ruleId": "html-lang-valid",
      "sc": [
        "3.1.1"
      ],
      "outOfScopeSc": [],
      "help": "<html> element must have a valid value for the lang attribute",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/html-lang-valid?application=axeAPI",
      "tags": [
        "ACT",
        "cat.language",
        "EN-301-549",
        "EN-9.3.1.1",
        "RGAA-8.4.1",
        "RGAAv4",
        "TT11.a",
        "TTv5",
        "wcag2a",
        "wcag311"
      ]
    },
    {
      "ruleId": "html-xml-lang-mismatch",
      "sc": [
        "3.1.1"
      ],
      "outOfScopeSc": [],
      "help": "HTML elements with lang and xml:lang must have the same base language",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/html-xml-lang-mismatch?application=axeAPI",
      "tags": [
        "ACT",
        "cat.language",
        "EN-301-549",
        "EN-9.3.1.1",
        "RGAA-8.3.1",
        "RGAAv4",
        "wcag2a",
        "wcag311"
      ]
    },
    {
      "ruleId": "identical-links-same-purpose",
      "sc": [],
      "outOfScopeSc": [
        "2.4.9"
      ],
      "help": "Links with the same name must have a similar purpose",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/identical-links-same-purpose?application=axeAPI",
      "tags": [
        "cat.semantics",
        "wcag249",
        "wcag2aaa"
      ]
    },
    {
      "ruleId": "image-alt",
      "sc": [
        "1.1.1"
      ],
      "outOfScopeSc": [],
      "help": "Images must have alternative text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/image-alt?application=axeAPI",
      "tags": [
        "ACT",
        "cat.text-alternatives",
        "EN-301-549",
        "EN-9.1.1.1",
        "RGAA-1.1.1",
        "RGAAv4",
        "section508",
        "section508.22.a",
        "TT7.a",
        "TT7.b",
        "TTv5",
        "wcag111",
        "wcag2a"
      ]
    },
    {
      "ruleId": "input-button-name",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Input buttons must have discernible text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/input-button-name?application=axeAPI",
      "tags": [
        "ACT",
        "cat.name-role-value",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-11.9.1",
        "RGAAv4",
        "section508",
        "section508.22.a",
        "TT5.c",
        "TTv5",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "input-image-alt",
      "sc": [
        "1.1.1",
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Image buttons must have alternative text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/input-image-alt?application=axeAPI",
      "tags": [
        "ACT",
        "cat.text-alternatives",
        "EN-301-549",
        "EN-9.1.1.1",
        "EN-9.4.1.2",
        "RGAA-1.1.3",
        "RGAAv4",
        "section508",
        "section508.22.a",
        "TT7.a",
        "TTv5",
        "wcag111",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "label",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Form elements must have labels",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/label?application=axeAPI",
      "tags": [
        "ACT",
        "cat.forms",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-11.1.1",
        "RGAAv4",
        "section508",
        "section508.22.n",
        "TT5.c",
        "TTv5",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "label-content-name-mismatch",
      "sc": [
        "2.5.3"
      ],
      "outOfScopeSc": [],
      "help": "Elements must have their visible text as part of their accessible name",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/label-content-name-mismatch?application=axeAPI",
      "tags": [
        "cat.semantics",
        "EN-301-549",
        "EN-9.2.5.3",
        "experimental",
        "RGAA-6.1.5",
        "RGAAv4",
        "wcag21a",
        "wcag253"
      ]
    },
    {
      "ruleId": "link-in-text-block",
      "sc": [
        "1.4.1"
      ],
      "outOfScopeSc": [],
      "help": "Links must be distinguishable without relying on color",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/link-in-text-block?application=axeAPI",
      "tags": [
        "cat.color",
        "EN-301-549",
        "EN-9.1.4.1",
        "RGAA-10.6.1",
        "RGAAv4",
        "TT13.a",
        "TTv5",
        "wcag141",
        "wcag2a"
      ]
    },
    {
      "ruleId": "link-name",
      "sc": [
        "2.4.4",
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Links must have discernible text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/link-name?application=axeAPI",
      "tags": [
        "ACT",
        "cat.name-role-value",
        "EN-301-549",
        "EN-9.2.4.4",
        "EN-9.4.1.2",
        "RGAA-6.2.1",
        "RGAAv4",
        "section508",
        "section508.22.a",
        "TT6.a",
        "TTv5",
        "wcag244",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "list",
      "sc": [
        "1.3.1"
      ],
      "outOfScopeSc": [],
      "help": "<ul> and <ol> must only directly contain <li>, <script> or <template> elements",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/list?application=axeAPI",
      "tags": [
        "cat.structure",
        "EN-301-549",
        "EN-9.1.3.1",
        "RGAA-9.3.1",
        "RGAAv4",
        "wcag131",
        "wcag2a"
      ]
    },
    {
      "ruleId": "listitem",
      "sc": [
        "1.3.1"
      ],
      "outOfScopeSc": [],
      "help": "<li> elements must be contained in a <ul> or <ol>",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/listitem?application=axeAPI",
      "tags": [
        "cat.structure",
        "EN-301-549",
        "EN-9.1.3.1",
        "RGAA-9.3.1",
        "RGAAv4",
        "wcag131",
        "wcag2a"
      ]
    },
    {
      "ruleId": "marquee",
      "sc": [
        "2.2.2"
      ],
      "outOfScopeSc": [],
      "help": "<marquee> elements are deprecated and must not be used",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/marquee?application=axeAPI",
      "tags": [
        "cat.parsing",
        "EN-301-549",
        "EN-9.2.2.2",
        "RGAA-13.8.1",
        "RGAAv4",
        "TT2.b",
        "TTv5",
        "wcag222",
        "wcag2a"
      ]
    },
    {
      "ruleId": "meta-refresh",
      "sc": [
        "2.2.1"
      ],
      "outOfScopeSc": [],
      "help": "Delayed refresh under 20 hours must not be used",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/meta-refresh?application=axeAPI",
      "tags": [
        "cat.time-and-media",
        "EN-301-549",
        "EN-9.2.2.1",
        "RGAA-13.1.2",
        "RGAAv4",
        "TT8.a",
        "TTv5",
        "wcag221",
        "wcag2a"
      ]
    },
    {
      "ruleId": "meta-refresh-no-exceptions",
      "sc": [],
      "outOfScopeSc": [
        "2.2.4",
        "3.2.5"
      ],
      "help": "Delayed refresh must not be used",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/meta-refresh-no-exceptions?application=axeAPI",
      "tags": [
        "cat.time-and-media",
        "wcag224",
        "wcag2aaa",
        "wcag325"
      ]
    },
    {
      "ruleId": "meta-viewport",
      "sc": [
        "1.4.4"
      ],
      "outOfScopeSc": [],
      "help": "Zooming and scaling must not be disabled",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/meta-viewport?application=axeAPI",
      "tags": [
        "ACT",
        "cat.sensory-and-visual-cues",
        "EN-301-549",
        "EN-9.1.4.4",
        "RGAA-10.4.2",
        "RGAAv4",
        "wcag144",
        "wcag2aa"
      ]
    },
    {
      "ruleId": "nested-interactive",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Interactive controls must not be nested",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/nested-interactive?application=axeAPI",
      "tags": [
        "cat.keyboard",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-7.1.1",
        "RGAAv4",
        "TT6.a",
        "TTv5",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "no-autoplay-audio",
      "sc": [
        "1.4.2"
      ],
      "outOfScopeSc": [],
      "help": "<video> or <audio> elements must not play automatically",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/no-autoplay-audio?application=axeAPI",
      "tags": [
        "ACT",
        "cat.time-and-media",
        "EN-301-549",
        "EN-9.1.4.2",
        "RGAA-4.10.1",
        "RGAAv4",
        "TT2.a",
        "TTv5",
        "wcag142",
        "wcag2a"
      ]
    },
    {
      "ruleId": "object-alt",
      "sc": [
        "1.1.1"
      ],
      "outOfScopeSc": [],
      "help": "<object> elements must have alternative text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/object-alt?application=axeAPI",
      "tags": [
        "cat.text-alternatives",
        "EN-301-549",
        "EN-9.1.1.1",
        "RGAA-1.1.6",
        "RGAAv4",
        "section508",
        "section508.22.a",
        "wcag111",
        "wcag2a"
      ]
    },
    {
      "ruleId": "p-as-heading",
      "sc": [
        "1.3.1"
      ],
      "outOfScopeSc": [],
      "help": "Styled <p> elements must not be used as headings",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/p-as-heading?application=axeAPI",
      "tags": [
        "cat.semantics",
        "EN-301-549",
        "EN-9.1.3.1",
        "experimental",
        "RGAA-9.1.3",
        "RGAAv4",
        "wcag131",
        "wcag2a"
      ]
    },
    {
      "ruleId": "role-img-alt",
      "sc": [
        "1.1.1"
      ],
      "outOfScopeSc": [],
      "help": "[role=\"img\"] elements must have alternative text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/role-img-alt?application=axeAPI",
      "tags": [
        "ACT",
        "cat.text-alternatives",
        "EN-301-549",
        "EN-9.1.1.1",
        "RGAA-1.1.1",
        "RGAAv4",
        "section508",
        "section508.22.a",
        "TT7.a",
        "TTv5",
        "wcag111",
        "wcag2a"
      ]
    },
    {
      "ruleId": "scrollable-region-focusable",
      "sc": [
        "2.1.1"
      ],
      "outOfScopeSc": [
        "2.1.3"
      ],
      "help": "Scrollable region must have keyboard access",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/scrollable-region-focusable?application=axeAPI",
      "tags": [
        "cat.keyboard",
        "EN-301-549",
        "EN-9.2.1.1",
        "EN-9.2.1.3",
        "RGAA-7.3.2",
        "RGAAv4",
        "TT4.a",
        "TTv5",
        "wcag211",
        "wcag213",
        "wcag2a"
      ]
    },
    {
      "ruleId": "select-name",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Select element must have an accessible name",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/select-name?application=axeAPI",
      "tags": [
        "ACT",
        "cat.forms",
        "EN-301-549",
        "EN-9.4.1.2",
        "RGAA-11.1.1",
        "RGAAv4",
        "section508",
        "section508.22.n",
        "TT5.c",
        "TTv5",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "server-side-image-map",
      "sc": [
        "2.1.1"
      ],
      "outOfScopeSc": [],
      "help": "Server-side image maps must not be used",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/server-side-image-map?application=axeAPI",
      "tags": [
        "cat.text-alternatives",
        "EN-301-549",
        "EN-9.2.1.1",
        "RGAA-1.1.4",
        "RGAAv4",
        "section508",
        "section508.22.f",
        "TT4.a",
        "TTv5",
        "wcag211",
        "wcag2a"
      ]
    },
    {
      "ruleId": "summary-name",
      "sc": [
        "4.1.2"
      ],
      "outOfScopeSc": [],
      "help": "Summary elements must have discernible text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/summary-name?application=axeAPI",
      "tags": [
        "cat.name-role-value",
        "EN-301-549",
        "EN-9.4.1.2",
        "section508",
        "section508.22.a",
        "TT6.a",
        "TTv5",
        "wcag2a",
        "wcag412"
      ]
    },
    {
      "ruleId": "svg-img-alt",
      "sc": [
        "1.1.1"
      ],
      "outOfScopeSc": [],
      "help": "<svg> elements with an img role must have alternative text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/svg-img-alt?application=axeAPI",
      "tags": [
        "ACT",
        "cat.text-alternatives",
        "EN-301-549",
        "EN-9.1.1.1",
        "RGAA-1.1.5",
        "RGAAv4",
        "section508",
        "section508.22.a",
        "TT7.a",
        "TTv5",
        "wcag111",
        "wcag2a"
      ]
    },
    {
      "ruleId": "table-fake-caption",
      "sc": [
        "1.3.1"
      ],
      "outOfScopeSc": [],
      "help": "Data or header cells must not be used to give caption to a data table.",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/table-fake-caption?application=axeAPI",
      "tags": [
        "cat.tables",
        "EN-301-549",
        "EN-9.1.3.1",
        "experimental",
        "RGAA-5.4.1",
        "RGAAv4",
        "section508",
        "section508.22.g",
        "wcag131",
        "wcag2a"
      ]
    },
    {
      "ruleId": "target-size",
      "sc": [
        "2.5.8"
      ],
      "outOfScopeSc": [],
      "help": "All touch targets must be 24px large, or leave sufficient space",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/target-size?application=axeAPI",
      "tags": [
        "cat.sensory-and-visual-cues",
        "wcag22aa",
        "wcag258"
      ]
    },
    {
      "ruleId": "td-has-header",
      "sc": [
        "1.3.1"
      ],
      "outOfScopeSc": [],
      "help": "Non-empty <td> elements in larger <table> must have an associated table header",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/td-has-header?application=axeAPI",
      "tags": [
        "cat.tables",
        "EN-301-549",
        "EN-9.1.3.1",
        "experimental",
        "RGAA-5.7.4",
        "RGAAv4",
        "section508",
        "section508.22.g",
        "TT14.b",
        "TTv5",
        "wcag131",
        "wcag2a"
      ]
    },
    {
      "ruleId": "td-headers-attr",
      "sc": [
        "1.3.1"
      ],
      "outOfScopeSc": [],
      "help": "Table cell headers attributes must refer to other <th> elements in the same table",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/td-headers-attr?application=axeAPI",
      "tags": [
        "cat.tables",
        "EN-301-549",
        "EN-9.1.3.1",
        "RGAA-5.7.4",
        "RGAAv4",
        "section508",
        "section508.22.g",
        "TT14.b",
        "TTv5",
        "wcag131",
        "wcag2a"
      ]
    },
    {
      "ruleId": "th-has-data-cells",
      "sc": [
        "1.3.1"
      ],
      "outOfScopeSc": [],
      "help": "Table headers in a data table must refer to data cells",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/th-has-data-cells?application=axeAPI",
      "tags": [
        "cat.tables",
        "EN-301-549",
        "EN-9.1.3.1",
        "RGAA-5.7.1",
        "RGAAv4",
        "section508",
        "section508.22.g",
        "TT14.b",
        "TTv5",
        "wcag131",
        "wcag2a"
      ]
    },
    {
      "ruleId": "valid-lang",
      "sc": [
        "3.1.2"
      ],
      "outOfScopeSc": [],
      "help": "lang attribute must have a valid value",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/valid-lang?application=axeAPI",
      "tags": [
        "ACT",
        "cat.language",
        "EN-301-549",
        "EN-9.3.1.2",
        "RGAA-8.8.1",
        "RGAAv4",
        "TT11.b",
        "TTv5",
        "wcag2aa",
        "wcag312"
      ]
    },
    {
      "ruleId": "video-caption",
      "sc": [
        "1.2.2"
      ],
      "outOfScopeSc": [],
      "help": "<video> elements must have captions",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/video-caption?application=axeAPI",
      "tags": [
        "cat.text-alternatives",
        "EN-301-549",
        "EN-9.1.2.2",
        "RGAA-4.3.1",
        "RGAAv4",
        "section508",
        "section508.22.a",
        "TT17.a",
        "TTv5",
        "wcag122",
        "wcag2a"
      ]
    }
  ]
};
