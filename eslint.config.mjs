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
            { sourceTag: 'type:lib', notDependOnLibsWithTags: ['type:app'] },
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
            {
              sourceTag: 'area:feature',
              notDependOnLibsWithTags: ['area:adapter'],
            },
            {
              sourceTag: 'area:adapter',
              notDependOnLibsWithTags: ['area:feature'],
            },
          ],
        },
      ],
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
