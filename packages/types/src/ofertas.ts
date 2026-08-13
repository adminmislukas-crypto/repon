import type { Urgencia } from './refill-matching.js';

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

// design.md D14 (backend-core-api-ofertas) — the 3 additions below. `Offer`/
// `OfferItem` above are unchanged by this domain change.

/** Item de una oferta reactiva a componer (`enviarOferta`'s input) —
 *  mirrors `OfferItemReactiva`'s discriminant shape, `providerCatalogItemId`
 *  structurally excluded via `?: never`. */
export type NuevoOfferItemReactiva = OfferItemPricing &
  OfferItemAlt & {
    refillItemId: string;
    providerCatalogItemId?: never;
  };

/** Item de una oferta proactiva a componer (`enviarOfertaProactiva`'s
 *  input) — mirrors `OfferItemProactiva`, `refillItemId` excluded. */
export type NuevoOfferItemProactiva = OfferItemPricing &
  OfferItemAlt & {
    providerCatalogItemId: string;
    refillItemId?: never;
  };

/**
 * Input shape for both `enviarOferta`/`enviarOfertaProactiva` — structurally
 * identical to `OfferItem` TODAY, but deliberately a **named type**, never
 * an alias of `OfferItem` (`shared-types-package` spec, reconciliation
 * table row 9): an alias would turn the first future divergence between
 * "what a client submits" and "what got persisted" (e.g. a `cantidad`
 * field) into a breaking rename instead of an additive field.
 */
export type NuevoOfferItem = NuevoOfferItemReactiva | NuevoOfferItemProactiva;

/** Delivery terms attached to a composed offer (`enviarOferta`'s input,
 *  `db-schema-ofertas`'s `offers.tiempo_entrega_horas`/`.costo_despacho`). */
export interface DatosEntrega {
  tiempoEntregaHoras: number;
  costoDespacho: number;
}

export interface SolicitudElegibleItem {
  refillItemId: string;
  nombre: string;
  categoria: string;
  precioReferencia: number;
  catalogProductId?: string;
}

/**
 * `listarSolicitudesElegibles`'s read model (design.md Diagrama 3) —
 * `urgencia` reuses `Urgencia` from `./refill-matching.js`, never
 * re-declared. Deliberately **no** `userId` field: the provider does not
 * need the recipient's `profileId` to compose an offer, and exposing it
 * would turn this route into a profile enumerator.
 */
export interface SolicitudElegible {
  refillRequestId: string;
  comuna: string;
  urgencia: Urgencia;
  matchedAt: string;
  items: SolicitudElegibleItem[];
}
