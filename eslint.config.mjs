// ESLint flat config. The repo is otherwise lint-free (Prettier + tsc do the
// rest); ESLint exists here for TWO jobs, both via @nx/eslint-plugin:
//
//   1. @nx/enforce-module-boundaries — tag-based import barriers. Replaces the
//      hand-maintained no-restricted-imports globs (REP-63). Every project is
//      tagged type:app|lib + scope:backend|frontend|shared (package.json#nx.tags);
//      the two Rule-6 libs additionally carry area:adapter / area:feature.
//
//   2. @nx/dependency-checks — every package must DECLARE every package it
//      imports. Catches phantom deps: importing a package that only resolves
//      because it's hoisted / globally installed but isn't in this project's
//      package.json. Severity error from day one.
//
// Manifesto §5 boundaries, now expressed as tag constraints below:
//   - app ↛ app, lib ↛ app (Rule 1a: features↛api/cli)
//   - backend ↮ frontend; shared imports only shared
//   - adapters ↮ features (Rule 6, via the area: tags)
//
// Rule 1b (a feature reaching a SIBLING feature's views/ directly) is not
// expressible at project granularity — it stays a documented manifesto
// convention. Cross-package access is already blocked by each feature package's
// exports map (only ./accounts/service + ./accounts/error are public).
import nx from '@nx/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import * as jsoncParser from 'jsonc-eslint-parser';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/generated.ts',
      '.devctl_generated/**',
      '.devctl-worktrees/**',
      '.nx/**',
    ],
  },
  // Module boundaries — runs on all workspace TS. The parser is needed only so
  // ESLint can read .ts syntax; no type-aware rules are enabled.
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: { '@nx': nx },
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:lib'] },
            // The cli is the privileged launcher (ADR-016): the only package
            // permitted to import an app's ./start (type:cli → type:app) so
            // `services run` can boot it. It may also import any lib.
            {
              sourceTag: 'type:cli',
              onlyDependOnLibsWithTags: ['type:lib', 'type:app'],
            },
            // A lib imports neither an app nor the cli, and never the
            // app-runtime contract (boundary:app-runtime) — RunnableApp is for
            // apps + the cli only, so a lib can't reach it.
            {
              sourceTag: 'type:lib',
              notDependOnLibsWithTags: [
                'type:app',
                'type:cli',
                'boundary:app-runtime',
              ],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:backend',
              onlyDependOnLibsWithTags: ['scope:backend', 'scope:shared'],
            },
            {
              sourceTag: 'scope:frontend',
              onlyDependOnLibsWithTags: ['scope:frontend', 'scope:shared'],
            },
          ],
        },
      ],
    },
  },
  // no-console — all diagnostic + result output goes through @repel/logger, not
  // raw console. Test files keep console for spies/fixtures, and the logger
  // package itself legitimately uses console / process.stdout in its console
  // transport and output().
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
    ignores: [
      '**/__tests__/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      'packages/shared/logger/**',
    ],
    rules: {
      'no-console': 'error',
    },
  },
  // Dependency declaration — every imported package must be declared in the
  // project's own package.json. Lints the package.json files themselves.
  {
    files: ['packages/**/package.json'],
    languageOptions: { parser: jsoncParser },
    plugins: { '@nx': nx },
    rules: {
      // Test imports count: a package that imports `pg` (etc.) in its tests must
      // declare it. No test-file exclusion — undeclared imports fail everywhere.
      // `vite` + its plugin are build tooling consumed by vite.config.ts / the
      // build script; they legitimately live in devDependencies.
      '@nx/dependency-checks': [
        'error',
        {
          ignoredDependencies: ['vite', '@vitejs/plugin-react'],
        },
      ],
    },
  },
];
