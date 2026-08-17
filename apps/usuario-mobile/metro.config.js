// Learn more: https://docs.expo.dev/guides/monorepos/
//
// pnpm hoists dependencies via symlinks into the workspace root
// `node_modules/`, not this package's own `node_modules/` — Metro's
// default resolver assumes a flat, non-symlinked `node_modules` tree and
// won't find them without this. `EXPO_USE_METRO_WORKSPACE_ROOT=1` (set in
// package.json's scripts) makes Expo CLI point Metro's project root at the
// monorepo root for config resolution; this file is the matching
// resolver/watcher config so Metro actually follows pnpm's symlinks and
// watches sibling workspace packages (e.g. `@repon/types`) for changes.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch every workspace package, not just this one, so editing
// `packages/types` triggers a Metro refresh here too.
config.watchFolders = [workspaceRoot];

// Resolve this app's own node_modules first, then fall back to the
// monorepo root's hoisted node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// pnpm's node_modules is a tree of symlinks — Metro must follow them
// instead of treating each package as an isolated, non-symlinked directory.
config.resolver.unstable_enableSymlinks = true;
// Don't let Metro walk up past this app looking for a closer node_modules
// per-import; with symlinks + explicit nodeModulesPaths above, hierarchical
// lookup only causes it to resolve the wrong copy of a hoisted dependency.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
