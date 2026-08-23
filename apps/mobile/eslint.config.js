// Ported from the False9 app's battle-tested config (~/Desktop/false9), the
// project this app deliberately clones conventions from. Differences from the
// source are downgrades of scope, not of strictness: the TanStack Query and
// jest blocks are omitted until those dependencies land (TODO markers below),
// and every rule False9 holds at `warn` pending a cleanup PR is `error` here,
// because this codebase starts with zero debt to amnesty.
// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const reactNativePlugin = require('eslint-plugin-react-native');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const jsdocPlugin = require('eslint-plugin-jsdoc');
const unusedImportsPlugin = require('eslint-plugin-unused-imports');
const regexpPlugin = require('eslint-plugin-regexp');
const noSecretsPlugin = require('eslint-plugin-no-secrets');
const tseslint = require('typescript-eslint');
const unicornPlugin = require('eslint-plugin-unicorn').default;
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');

// React Compiler (app.json experiments.reactCompiler) auto-memoizes
// components, values, and callbacks. Manual memoization conflicts with it.
const reactCompilerSelectors = [
  {
    selector: "CallExpression[callee.name='useMemo']",
    message: 'React Compiler memoizes automatically - remove useMemo.',
  },
  {
    selector: "CallExpression[callee.name='useCallback']",
    message: 'React Compiler memoizes automatically - remove useCallback.',
  },
  {
    selector: "MemberExpression[object.name='React'][property.name='memo']",
    message: 'React Compiler memoizes automatically - remove React.memo.',
  },
];

// The rules live in @pitch-snake/engine and nowhere else. A component that
// simulates locally will drift from the shared engine and produce scores the
// replay validator rejects.
const engineOnlySelectors = [
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message:
      'No Math.random in app code that can touch gameplay - the engine owns all randomness (seeded). For pure visual jitter, put it in the renderer layer and say so in a comment.',
  },
];

// Direct Supabase calls in components / screens fragment data flow and bypass
// TanStack Query's caching and invalidation. Wrap in a hook in hooks/queries/.
// (Future-proofing: supabase-js is not installed yet, but the day it lands
// this is already the law, as it is in False9.)
const noBusinessLogicInComponentsSelectors = [
  {
    selector: "CallExpression[callee.object.name='supabase'][callee.property.name='from']",
    message: "Don't call supabase.from in components - wrap in a TanStack Query hook in hooks/queries/.",
  },
  {
    selector: "CallExpression[callee.object.name='supabase'][callee.property.name='rpc']",
    message: "Don't call supabase.rpc in components - wrap in a TanStack Query hook in hooks/queries/.",
  },
  {
    selector: "CallExpression[callee.object.property.name='functions'][callee.property.name='invoke']",
    message:
      "Don't call edge functions directly in components - wrap in a TanStack Query hook in hooks/queries/. Auth flows excepted (annotate with eslint-disable).",
  },
];

// A Suspense fallback that renders nothing hides the loading state.
const suspenseFallbackSelectors = [
  {
    selector:
      "JSXElement[openingElement.name.name='Suspense'] > JSXOpeningElement > JSXAttribute[name.name='fallback'] > JSXExpressionContainer > Literal[value=null]",
    message: 'Suspense fallback={null} hides the loading state - render a placeholder matching the shape.',
  },
  {
    selector:
      "JSXElement[openingElement.name.name='Suspense'] > JSXOpeningElement > JSXAttribute[name.name='fallback'] > JSXExpressionContainer > JSXFragment",
    message: 'Suspense fallback={<></>} hides the loading state - render a placeholder matching the shape.',
  },
  {
    selector:
      "JSXElement[openingElement.name.name='Suspense'] > JSXOpeningElement > JSXAttribute[name.name='fallback'] > JSXExpressionContainer > JSXElement > JSXOpeningElement[name.name='ActivityIndicator']",
    message: 'Use a layout-mirroring placeholder instead of ActivityIndicator inside <Suspense fallback>.',
  },
];

// Service-role identifiers are forbidden in client code, full stop.
const serviceRoleSelectors = [
  {
    selector: "Identifier[name='adminClient']",
    message: 'adminClient bypasses RLS - never use on the client. Edge functions only.',
  },
  {
    selector: "Identifier[name='SUPABASE_SERVICE_ROLE_KEY']",
    message: 'SUPABASE_SERVICE_ROLE_KEY must never appear in client code. Edge functions only.',
  },
  {
    selector: "Literal[value='service_role']",
    message: "The literal 'service_role' must not appear in client code.",
  },
];

module.exports = defineConfig([
  {
    ignores: ['dist/*', '.expo/**', 'ios/**', 'android/**', 'node_modules/**'],
  },
  expoConfig,
  // typescript-eslint type-checked rules. False9 runs these tiered
  // (error/warn) because of adoption debt; here everything is error from
  // day one.
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      // Promise correctness - forgotten awaits and async-passed-where-void
      // are real bug classes.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      // `import type` for types-only imports; mirrors verbatimModuleSyntax.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      // `value ?? fallback` over `value || fallback`: `||` treats 0, '',
      // false as missing - a bug magnet for scores.
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      // Every switch over a discriminated union must cover every variant.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      // Lying types and dead branches.
      '@typescript-eslint/no-unnecessary-condition': ['error', { allowConstantLoopConditions: true }],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      // Block `${object}` in template literals: no `[object Object]` shipped.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowAny: false, allowNullish: false },
      ],
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/unbound-method': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      '@typescript-eslint/no-array-delete': 'error',
      '@typescript-eslint/no-duplicate-enum-values': 'error',
      '@typescript-eslint/no-duplicate-type-constituents': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      '@typescript-eslint/no-unnecessary-template-expression': 'error',
      '@typescript-eslint/no-unnecessary-type-arguments': 'error',
      '@typescript-eslint/no-unnecessary-type-conversion': 'error',
      '@typescript-eslint/no-mixed-enums': 'error',
      '@typescript-eslint/no-misused-spread': 'error',
      '@typescript-eslint/no-non-null-asserted-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-find': 'error',
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'error',
      '@typescript-eslint/no-meaningless-void-operator': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-unary-minus': 'error',
    },
  },
  // Catastrophic regex, confusing patterns, unicode bugs.
  regexpPlugin.configs['flat/recommended'],
  // react-hooks v7 recommended-latest: the React Compiler-powered semantic
  // rules (immutability, refs, set-state-in-render, purity, ...). All at the
  // preset's levels; no downgrades - we have no pre-existing hits.
  reactHooksPlugin.configs.flat['recommended-latest'],
  // TODO when @tanstack/react-query lands: add @tanstack/eslint-plugin-query
  // with False9's tiering (exhaustive-deps, no-unstable-deps, no-void-query-fn,
  // stable-query-client at error).
  // TODO when a test runner lands here: add eslint-plugin-jest per False9.
  {
    plugins: {
      'react-native': reactNativePlugin,
      '@typescript-eslint': tseslint.plugin,
      jsdoc: jsdocPlugin,
      'unused-imports': unusedImportsPlugin,
      'no-secrets': noSecretsPlugin,
      unicorn: unicornPlugin,
    },
    rules: {
      'react-native/no-inline-styles': 'error',
      'react-native/no-unused-styles': 'error',
      // Strings outside <Text> throw at runtime on RN. Extend `skip` as
      // themed text wrappers appear.
      'react-native/no-raw-text': 'error',
      'react-native/no-single-element-style-arrays': 'error',
      // unused-imports is the single source of truth for unused checks.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', { args: 'none', vars: 'all', varsIgnorePattern: '^_' }],
      // High-entropy strings (tokens, keys) must not be committed. The
      // Supabase publishable key belongs in app config, not source.
      'no-secrets/no-secrets': [
        'error',
        { tolerance: 4.5, ignoreContent: ['\\.apps\\.googleusercontent\\.com$'] },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      // Spell identifiers out. Whitelist mirrors False9's JS/React
      // conventions, plus this game's own vocabulary.
      'unicorn/prevent-abbreviations': [
        'error',
        {
          replacements: {
            props: false,
            ref: false,
            refs: false,
            params: false,
            args: false,
            arg: false,
            prop: false,
            prev: false,
            e: false,
            i: false,
            idx: false,
            ctx: false,
            db: false,
            api: false,
            env: false,
            fn: false,
            cb: false,
            err: false,
            btn: false,
            val: false,
            msg: false,
            obj: false,
            num: false,
            len: false,
            min: false,
            max: false,
            arr: false,
            opts: false,
            evt: false,
            ev: false,
            j: false,
            curr: false,
            ext: false,
            res: false,
            req: false,
            // game vocabulary: milliseconds, delta-time, direction components
            ms: false,
            dt: false,
            dx: false,
            dy: false,
            px: false,
            py: false,
          },
          allowList: { i18n: true },
          checkFilenames: false,
        },
      ],
      'no-restricted-syntax': ['error', ...reactCompilerSelectors],
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              importNames: ['memo'],
              message: 'React Compiler memoizes automatically - do not use React.memo.',
            },
          ],
        },
      ],
      // JSDoc on every exported declaration; tests and d.ts are exempt below.
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
            'ExportNamedDeclaration > TSEnumDeclaration',
          ],
          enableFixer: false,
        },
      ],
      'jsdoc/require-description': [
        'error',
        { contexts: ['any'], exemptedBy: ['see', 'deprecated', 'inheritDoc'] },
      ],
    },
  },
  {
    // Client code: service-role bans and gameplay-randomness bans everywhere.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...reactCompilerSelectors,
        ...serviceRoleSelectors,
        ...engineOnlySelectors,
      ],
    },
  },
  {
    // Components and screens additionally must not contain data-layer calls.
    files: ['src/app/**/*.tsx', 'src/components/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...reactCompilerSelectors,
        ...serviceRoleSelectors,
        ...engineOnlySelectors,
        ...noBusinessLogicInComponentsSelectors,
        ...suspenseFallbackSelectors,
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
    rules: {
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-description': 'off',
    },
  },
  {
    // CJS config files run under Node, not React Native.
    files: ['eslint.config.js', 'metro.config.js', 'babel.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'unicorn/prevent-abbreviations': 'off',
    },
  },
  // MUST BE LAST: Prettier owns formatting unilaterally.
  prettierConfig,
]);
