// `.js` extensions on these relative re-exports (not `.ts`): NodeNext/node16
// module resolution requires explicit extensions on ESM relative imports —
// `.js` is TypeScript's own convention for referring to a `.ts` source file
// under that mode (it maps `.js` back to the sibling `.ts`/`.tsx` file).
// `packages/types`'s own `moduleResolution: "Bundler"` (tsconfig.base.json)
// tolerates this too, so this barrel stays consumable both by this
// package's own typecheck AND by `core-api` (`moduleResolution: "NodeNext"`,
// PR 5), which imports these types directly as source, not a built package.
export * from './identidad.js';
export * from './consumo.js';
export * from './catalogo.js';
export * from './refill-matching.js';
export * from './ofertas.js';
export * from './pedidos-pagos.js';
export * from './audit.js';
