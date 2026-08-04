// @ts-check
import fs from 'node:fs';
import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// ---------------------------------------------------------------------------
// Cross-domain import boundary (core-api-hexagonal-layout spec, R3).
//
// Only `domains/<name>/contracts/` is importable across a domain boundary.
// No file outside `domains/<name>/` — including the shared kernel and other
// domains — may import `domains/<name>/{ports-out,adapters/persistence,
// adapters/events,domain}/**`.
//
// No domain code exists yet (identidad lands PR 6+ of
// backend-core-api-foundation), so domain names are read from disk at config
// load time instead of hardcoded. Today `services/core-api/src/domains/`
// doesn't exist -> zero domains -> zero generated zones -> the domain-pair
// half of this rule is a structural no-op until real domain folders land.
// The shared-kernel zone below needs no domain enumeration and is already
// live as soon as the first domain exists.
// ---------------------------------------------------------------------------

const CORE_API_SRC = 'services/core-api/src';
const DOMAINS_DIR = `${CORE_API_SRC}/domains`;
const RESTRICTED_SUBPATHS = ['ports-out', 'adapters/persistence', 'adapters/events', 'domain'];

function readDomainNames() {
  try {
    return fs
      .readdirSync(DOMAINS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function buildCrossDomainZones() {
  const domains = readDomainNames();
  const zones = [];

  // Zone family 1: domain A's internals are off-limits to every OTHER
  // domain (but not to itself — same-domain imports of its own ports-out /
  // adapters / domain layer are how a domain wires its own module).
  for (const owner of domains) {
    const otherDomains = domains.filter((name) => name !== owner);
    if (otherDomains.length === 0) continue;
    for (const subpath of RESTRICTED_SUBPATHS) {
      zones.push({
        target: otherDomains.map((name) => `./${DOMAINS_DIR}/${name}/**/*`),
        from: `./${DOMAINS_DIR}/${owner}/${subpath}/**/*`,
        message: `Only domains/${owner}/contracts/ is importable across a domain boundary (core-api-hexagonal-layout).`,
      });
    }
  }

  // Zone family 2: the shared kernel never imports a domain's internals —
  // it declares ports (e.g. ActorPort); domains implement them (inversion
  // of dependency, core-api-hexagonal-layout scenario "identidad's
  // ActorPort implementation is the reference pattern"). Static: doesn't
  // need to know which domains exist.
  for (const subpath of RESTRICTED_SUBPATHS) {
    zones.push({
      target: `./${CORE_API_SRC}/shared/**/*`,
      from: `./${DOMAINS_DIR}/*/${subpath}/**/*`,
      message:
        "shared/ MUST NOT import a domain's internals — only domains/<name>/contracts/ (core-api-hexagonal-layout).",
    });
  }

  return zones;
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '.atl/**',
      'openspec/**',
      'supabase/**',
      'docs/**',
      '**/mockups/**',
      '**/*.md',
      '**/*.sql',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      // Duplicated by TypeScript's own compiler diagnostics (`strict: true`
      // in tsconfig.base.json handles unreachable/unused-vars-adjacent
      // classes of bugs); ESLint's job here is style + import boundaries,
      // not re-litigating what `tsc` already checks.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Root-level Node tooling config files (this file included) — not part
    // of any workspace package's tsconfig, plain Node/CJS-or-ESM globals.
    files: ['*.config.{js,mjs,cjs,ts}', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // The cross-domain import boundary — see rationale block above.
    files: [`${CORE_API_SRC}/**/*.{ts,tsx}`],
    plugins: {
      'import-x': importX,
    },
    settings: {
      'import-x/resolver': {
        node: {
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
        },
      },
    },
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: buildCrossDomainZones(),
        },
      ],
    },
  },
  prettierConfig,
);
