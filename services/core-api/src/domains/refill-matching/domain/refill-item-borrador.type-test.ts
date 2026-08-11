import type { RefillItemBorrador } from '@repon/types';
import type { CatalogQueryPort } from '../../catalogo/contracts/catalog-query.port';

/**
 * TYPE-LEVEL fixture, checked by `tsc`/`pnpm typecheck` — NOT a Jest runtime
 * test (tasks.md 1.6, design.md D-B). This is the RED step for PR1's Phase 1:
 * strict TDD applies even here, just at the type-checker level instead of
 * Jest's. An unused `@ts-expect-error` directive is itself a `tsc` error, so
 * the pass/fail signal is `pnpm typecheck` succeeding — no assertion, no
 * `describe`/`it`, no test runner involved.
 *
 * Proves the load-bearing claim of D-B: `RefillItemBorrador[]` is NOT
 * assignable where `RefillItem[]` is expected. Uses
 * `CatalogQueryPort['buscarCoincidencias']`'s own (frozen, C1–C8) parameter
 * type as the target, via a type-only import — no module wiring, no
 * `CatalogoModule` import, nothing runtime happens here. This is the
 * compile-time backstop for "a borrador never enters matching" (D3): with
 * this shape in place, passing a borrador's items to the real use case
 * (Phase 5a) would fail to compile even if every runtime guard were
 * accidentally removed.
 */
declare const buscarCoincidencias: CatalogQueryPort['buscarCoincidencias'];
declare const itemsBorrador: RefillItemBorrador[];

// @ts-expect-error — RefillItemBorrador[] is not assignable to RefillItem[]:
// `categoria`/`precioReferencia` are optional on the borrador variant but
// required on RefillItem. If this line ever stops erroring, RefillItem's
// frozen shape (design.md D-B) has been widened by mistake — stop and check
// packages/types/src/refill-matching.ts before proceeding.
void buscarCoincidencias(itemsBorrador);
