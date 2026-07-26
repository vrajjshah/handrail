import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.tsbuild/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'fixtures/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // The glass house, at lint time. `strict` rather than `recommended`: an
  // accessibility tool does not get to ship the interface with the looser
  // preset, and every rule it adds over `recommended` is one our own engine
  // would flag on somebody else's site.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    // `configs.flat[...]`, not `configs[...]`: the top-level entries are still
    // the eslintrc shape and hand ESLint 10 a `plugins` array, which it
    // rejects outright with a migration message.
    extends: [jsxA11y.flatConfigs.strict, reactHooks.configs.flat['recommended-latest']],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // `role="list"` on a `ul`/`ol` is redundant on paper and load-bearing in
      // practice: Safari drops list semantics when `list-style: none` is
      // applied, which Tailwind's reset does to every list. Without the
      // explicit role, VoiceOver stops announcing "list, 3 items". Narrowed to
      // exactly that pair so every other redundant role stays an error.
      'jsx-a11y/no-redundant-roles': ['error', { ul: ['list'], ol: ['list'] }],
    },
  },
  {
    files: ['**/*.js', '**/*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
