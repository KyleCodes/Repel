// ESLint flat config. The repo is otherwise lint-free (Prettier + tsc do the
// rest); ESLint exists here for ONE job: enforcing the architecture manifesto's
// import barriers as a machine-checkable gate rather than a review convention.
//
// Enforced (manifesto §5):
//   Rule 1a — features/* may NOT import from api/ or cli/.
//   Rule 6  — features/* may NOT import from adapters/, and
//             adapters/* may NOT import from features/.
//
// Rule 1b (cross-feature reads go through views/) is NOT encoded here: it needs
// a same-layer allow/deny that no-restricted-imports' path globs express poorly
// (a feature importing its OWN siblings' views is legal; importing their
// mutations/service is not). It stays a documented convention until a type-aware
// boundary plugin is justified. See DR-REP-13-1.
//
// Backend libs/apps are now separate workspace packages, so cross-boundary
// imports are bare specifiers (e.g. '@repel/backend-adapters'). The globs match
// the package name and any subpath export of it. (Tag-based enforcement via
// @nx/enforce-module-boundaries replaces this in REP-63.)
import tsParser from '@typescript-eslint/parser';

const adaptersFromFeatures = {
  group: ['@repel/backend-adapters', '@repel/backend-adapters/**'],
  message:
    'Manifesto Rule 6: features/ must not import from adapters/. Communicate via transport envelopes.',
};

const featuresFromAdapters = {
  group: ['@repel/backend-features', '@repel/backend-features/**'],
  message:
    'Manifesto Rule 6: adapters/ must not import from features/. Communicate via transport envelopes.',
};

const facadeFromFeatures = {
  group: ['@repel/backend-api', '@repel/backend-cli'],
  message:
    'Manifesto Rule 1a: features/ must not import from api/ or cli/. Facades consume features, not the reverse.',
};

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/generated.ts',
      '.devctl_generated/**',
      '.devctl-worktrees/**',
    ],
  },
  // Parse all workspace TypeScript with the typescript-eslint parser. No
  // type-aware rules are enabled (minimal footprint, DR-REP-13-1); the parser
  // is needed only so ESLint can read .ts syntax for no-restricted-imports.
  {
    files: ['packages/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  // Rule 6 + Rule 1a: features/ may not reach into adapters/, api/, or cli/.
  {
    files: ['packages/backend/libs/features/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [adaptersFromFeatures, facadeFromFeatures] },
      ],
    },
  },
  // Rule 6: adapters/ may not reach into features/.
  {
    files: ['packages/backend/libs/adapters/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [featuresFromAdapters] }],
    },
  },
];
