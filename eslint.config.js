// Lint for the PAGE's browser modules (page/*.ts).
//
// Ported from the False9 app's config (~/Desktop/false9/eslint.config.js), the
// same production reference apps/mobile clones. What is dropped is dropped for
// a reason and not for quiet: React, React Native, React Compiler, TanStack
// Query and jest have no meaning in a plain browser module. What is kept is
// the whole type-aware tier list, the descriptive-naming rule with its
// whitelist, the secret scanner, and JSDoc on every export, because those are
// the conventions the root CLAUDE.md states and they were previously enforced
// on exactly half the repo.
//
// The app is linted by its own workspace script against its own config; this
// covers the other half, which had no linter at all until 2026-09-07.
//
// Type-aware rules need a program, so the parser is pointed at
// page/tsconfig.json. Both generated trees are ignored, page/.tsc (tsc's own
// emit) and page/build (that emit minified): neither is in that tsconfig's
// `include`, and linting a compiler's output tells you nothing about the
// source that produced it. The staging tree matters here because tsc carries
// the sources' eslint-disable comments through into it, and a disable for a
// type-aware rule is an error in a file no type-aware rule runs on.
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const jsdocPlugin = require('eslint-plugin-jsdoc');
const unusedImportsPlugin = require('eslint-plugin-unused-imports');
const regexpPlugin = require('eslint-plugin-regexp');
const noSecretsPlugin = require('eslint-plugin-no-secrets');
const unicornPlugin = require('eslint-plugin-unicorn').default;
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');

// The rules live in @pitch-snake/engine and nowhere else. A page module that
// simulates locally will drift from the shared engine and produce scores the
// replay validator rejects. Sound and art are the sanctioned exceptions and
// carry a file-level disable with the reason, exactly as False9 does for its
// own unavoidable cases.
const engineOnlySelectors = [
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message:
      'No Math.random in code that can touch gameplay - the engine owns all randomness (seeded). Pure visual or audio jitter is allowed, with a file-level disable saying so.',
  },
];

// The page carries a PUBLISHABLE key on purpose (see the leaderboard rules in
// CLAUDE.md). A secret key would be a different matter entirely, and this is
// what would catch one arriving.
const serviceRoleSelectors = [
  {
    selector: "Literal[value=/service_role/]",
    message:
      'service_role must never appear in code that ships to a browser. The RPCs are the access; see supabase/leaderboard.sql rule 1.',
  },
];

module.exports = defineConfig([
  {
    // Generated, third-party, or separately-linted trees.
    ignores: [
      'page/.tsc/**', // tsc's staging emit; the .ts source is what gets linted
      'page/build/**', // that emit, minified; the .ts source is what gets linted
      'node_modules/**',
      'apps/**', // its own workspace, its own config, its own script
      'packages/**', // the engine is plain JS on purpose: three runtimes import it raw
      'styles/**',
      'supabase/**',
      'cloudflare/**',
      'scripts/**', // shell and node tooling; never reaches a browser
    ],
  },
  {
    files: ['page/**/*.ts'],
    extends: [
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      jsdocPlugin.configs['flat/recommended-typescript-error'],
      regexpPlugin.configs['flat/recommended'],
      unicornPlugin.configs['flat/recommended'],
      prettierConfig,
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: { defaultProject: 'page/tsconfig.json' },
        tsconfigRootDir: __dirname,
      },
      globals: { ...globals.browser },
    },
    plugins: {
      jsdoc: jsdocPlugin,
      'unused-imports': unusedImportsPlugin,
      'no-secrets': noSecretsPlugin,
      unicorn: unicornPlugin,
    },
    rules: {
      // ---- promise correctness: real bug classes, both of them ----
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/promise-function-async': 'error',

      // ---- tier 1: low-noise correctness, all auto-fixable or near it ----
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': ['error', { allowConstantLoopConditions: true }],
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      '@typescript-eslint/unbound-method': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      '@typescript-eslint/no-array-delete': 'error',
      '@typescript-eslint/no-duplicate-type-constituents': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      '@typescript-eslint/no-unnecessary-template-expression': 'error',
      '@typescript-eslint/no-unnecessary-type-arguments': 'error',
      '@typescript-eslint/no-mixed-enums': 'error',
      '@typescript-eslint/no-misused-spread': 'error',
      '@typescript-eslint/no-non-null-asserted-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-find': 'error',
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'error',
      '@typescript-eslint/no-meaningless-void-operator': 'error',

      // ---- the `any` firewall ----
      // CLAUDE.md: "No `any`. A new exception needs an inline disable and a
      // one-line reason." and "Type guards over assertions": a cast lies to
      // the compiler, a guard tells it something true.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-unary-minus': 'error',

      // unused-imports is the single source of truth, so both stock rules go
      // off, exactly as False9 has it.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', { args: 'none', vars: 'all', varsIgnorePattern: '^_' }],

      // ---- secrets ----
      // The publishable key is public by design and its entropy is below the
      // tolerance; a service key would not be. FLAG_CODES is the one standing
      // exception and carries its own inline disable with the reason.
      'no-secrets/no-secrets': ['error', { tolerance: 4.5 }],

      // ---- descriptive naming (the owner's stated standard) ----
      // Spell identifiers out. The whitelist is False9's, plus this repo's own
      // deliberate exceptions from CLAUDE.md's naming section.
      'unicorn/prevent-abbreviations': [
        'error',
        {
          replacements: {
            props: false, ref: false, refs: false, params: false, args: false, arg: false,
            prop: false, prev: false, e: false, i: false, idx: false, ctx: false,
            db: false, api: false, env: false, fn: false, cb: false, err: false,
            btn: false, val: false, msg: false, obj: false, num: false, len: false,
            min: false, max: false, arr: false, opts: false, evt: false, ev: false,
            j: false, curr: false, ext: false, res: false, req: false,
            // pitch-snake domain, from CLAUDE.md's naming rules: `p` for a
            // player and `g`/`gh` for a ghost inside tight loops, and `ms` for
            // milliseconds, which is the unit suffix on every timing constant.
            ms: false,
            dest: false,
            buf: false,
            src: false,
            dir: false,
          },
          checkFilenames: false,
        },
      ],

      'no-restricted-syntax': ['error', ...engineOnlySelectors, ...serviceRoleSelectors],

      // ---- JSDoc on every export ----
      // CLAUDE.md: "Every module opens with a block saying what it owns and
      // what it must never do. Every exported function carries a doc comment."
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            ArrowFunctionExpression: false,
            ClassDeclaration: true,
            ClassExpression: true,
            FunctionDeclaration: true,
            FunctionExpression: false,
            MethodDefinition: true,
          },
          contexts: [
            'ExportNamedDeclaration > VariableDeclaration',
            'ExportNamedDeclaration > TSInterfaceDeclaration',
            'ExportNamedDeclaration > TSTypeAliasDeclaration',
          ],
          enableFixer: false,
        },
      ],
      'jsdoc/require-description': ['error', { contexts: ['any'], exemptedBy: ['see', 'deprecated', 'inheritDoc'] }],
      // TypeScript owns the types; a {type} in a JSDoc tag is a second source
      // of truth that goes stale silently.
      'jsdoc/no-types': 'error',
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns-type': 'off',
      // `@returns` is required by the recommended set, but a `: void` signature
      // says it better than a sentence can.
      'jsdoc/require-returns': 'off',
      // The repo's house style opens every module with `@module` under a prose
      // block, and puts a blank line before the tags.
      'jsdoc/tag-lines': ['error', 'any', { startLines: null }],
      'jsdoc/check-tag-names': ['error', { definedTags: ['module'] }],

      // ---- browser reality ----
      // `window` is the honest name in a document; globalThis is for code that
      // must also run in node, and none of this can.
      'unicorn/prefer-global-this': 'off',
      // `null` is meaningful here: the Supabase contract distinguishes null
      // (keep) from '' (clear), and the DOM answers null all day long.
      'unicorn/no-null': 'off',
      // A for loop over a typed array of audio samples is the clearest form.
      'unicorn/no-for-loop': 'off',
      'unicorn/number-literal-case': 'off',
      // getElementById is the honest API for looking up an id, and faster than
      // parsing a selector to do the same thing. dom.ts is the only place that
      // calls it and it wraps it in a null check the querySelector form needs
      // just as much.
      'unicorn/prefer-query-selector': 'off',
      // Timing constants read better as plain digits beside SIM_DT multiples.
      'unicorn/numeric-separators-style': 'off',
      // A failure must never reach the round, so an empty catch is often
      // right. It has to be SAID, though, which the comment requirement does.
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  {
    // This config file is CommonJS run by node, not browser TypeScript.
    files: ['eslint.config.js'],
    languageOptions: { globals: { ...globals.node }, sourceType: 'commonjs' },
  },
]);
