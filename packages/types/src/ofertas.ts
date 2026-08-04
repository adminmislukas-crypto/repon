export type OfferKind = 'reactiva' | 'proactiva';

/**
 * A new offer always starts `'pendiente'` — a creation-time invariant, not
 * a structural constraint on `Offer` itself (enforced by the `ofertas`
 * domain's `enviarOferta`/`enviarOfertaProactiva` use cases, not yet built
 * in this change: Phase 5 of `backend-core-api-foundation` only declares
 * `ofertas`' ports-out as a placeholder, no use-case bodies).
 * `'aceptada'` is reached via `aceptarOferta`, which — in the same
 * operation — displaces every other `'pendiente'` offer on the same
 * `refillRequestId` to `'rechazada'` (the only trigger for `'rechazada'`
 * today, `db-schema-ofertas` lote `05`). `'expirada'` is schema-supported
 * but has no triggering use case yet.
 */
export type OfferStatus = 'pendiente' | 'aceptada' | 'rechazada' | 'expirada';

/**
 * Discriminated on `isAlt` — `altNote` is required exactly when an
 * alternative presentation is offered (`shared-types-package` spec,
 * Requirement "Validation rules documented in SPEC.md live in the
 * type/DTO, not only the form").
 */
export type OfferItemAlt =
  | { isAlt: true; altNote: string; altSize?: number; altQty?: number }
  | { isAlt: false; altNote?: string; altSize?: number; altQty?: number };

interface OfferItemPricing {
  precio: number;
}

/** Item of a `kind: 'reactiva'` offer — responds to a `RefillRequest`. */
export type OfferItemReactiva = OfferItemPricing &
  OfferItemAlt & {
    refillItemId: string;
    providerCatalogItemId?: never;
  };

/** Item of a `kind: 'proactiva'` offer — no originating `RefillRequest`. */
export type OfferItemProactiva = OfferItemPricing &
  OfferItemAlt & {
    providerCatalogItemId: string;
    refillItemId?: never;
  };

/**
 * Always exactly one of `refillItemId`/`providerCatalogItemId`, never both,
 * never neither — tied to the parent `Offer.kind` (`shared-types-package`
 * spec, "Reglas de validación").
 */
export type OfferItem = OfferItemReactiva | OfferItemProactiva;

interface OfferCommon {
  id: string;
  /** Recipient; always required, including proactive offers with no `refillRequestId`. */
  userId: string;
  companyId: string;
  status: OfferStatus;
  tiempoEntregaHoras: number;
  costoDespacho: number;
  total: number;
  mensaje?: string;
}

/**
 * Discriminated on `kind`: `refillRequestId` is present iff
 * `kind === 'reactiva'`, and `items` is narrowed to the matching
 * `OfferItem` variant. When `refillRequestId` is present, `Offer.userId`
 * MUST equal that `RefillRequest`'s `userId` — a cross-entity invariant
 * that lives in the `ofertas` use case, not something a structural type can
 * check statically.
 */
export type Offer =
  | (OfferCommon & { kind: 'reactiva'; refillRequestId: string; items: OfferItemReactiva[] })
  | (OfferCommon & { kind: 'proactiva'; refillRequestId?: never; items: OfferItemProactiva[] });
