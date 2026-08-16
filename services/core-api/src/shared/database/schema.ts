import type { ColumnType, Generated } from 'kysely';

// Kysely row types (`snake_case`, matches Postgres columns 1:1) for the
// tables this change's scope touches — `profiles`/`companies`/`admin_roles`
// (identidad's first three tables), `audit_log` (shared kernel), plus
// `catalog_products`/`provider_catalog`/`catalog_hidden_companies`
// (catalogo, backend-core-api-catalogo PR 1), `pets`/`user_consumption`/
// `consumption_logs` (consumo, backend-core-api-consumo PR 1), and
// `refill_requests`/`refill_items` (refill-matching, this change's own PR 1).
//
// design.md D-A's non-negotiable boundary: these row types never cross into
// `@repon/types` (which stays `camelCase`, domain-shaped) and never leave
// `shared/database/` + `adapters/persistence/` — the only two places
// allowed to know what a Postgres row actually looks like. The remaining
// 6 tables (`ofertas`/`pedidos-pagos`) get typed here as their owning
// domain change lands, not upfront.
//
// Source of truth for every column below:
// supabase/migrations/20260803120100_01a_identidad_core.sql (companies,
// profiles), .../20260803120110_01b_identidad_admin.sql (admin_roles),
// .../20260803120700_07_auditoria.sql (audit_log) — from the archived
// `backend-supabase-migrations` change; .../20260803120300_03_catalogo.sql
// (catalog_products, provider_catalog) and
// .../20260805120100_12_catalogo_hidden_companies.sql
// (catalog_hidden_companies) — from this change's own PR 1
// (backend-core-api-catalogo design.md D-A/D-C);
// .../20260803120200_02_consumo.sql (pets, user_consumption,
// consumption_logs) and .../20260806120000_13_consumo_stock_bajo_debounce.sql
// (user_consumption.stock_bajo_notificado_at) — from this domain's own
// backend-core-api-consumo PR 1 (design.md D-A/D12);
// .../20260803120400_04_refill_matching.sql (refill_requests, refill_items —
// NOT edited by this change, fix-forward, D9) plus
// .../20260807120000_14_refill_matching_estado_borrador.sql (the 'borrador'
// enum value) and .../20260807120100_15_refill_matching_completitud_diferida.sql
// (the 4 nullable columns + `consumption_id` + its partial unique index) —
// from this domain's own backend-core-api-refill-matching PR 1 (design.md D-A/D10/D-D.2);
// .../20260803120500_05_ofertas.sql (offers, offer_items — already applied,
// typed here for the first time, NOT edited by this change, fix-forward)
// plus .../20260808120000_16_ofertas_discovery_projection.sql
// (offer_opportunities, offer_opportunity_companies, offer_opportunity_items)
// — from this domain's own backend-core-api-ofertas PR 1 (design.md D-A/D14);
// .../20260803120600_06_pedidos_pagos.sql (orders, order_items, payments —
// already applied since the migrations change, typed here for the first
// time, NOT edited, fix-forward per D5) plus
// .../20260809120000_17a_pedidos_pagos_order_status_values.sql (the 2 new
// order_status enum values) and
// .../20260809120100_17b_pedidos_pagos_fix_forward.sql (orders.status'
// dropped default, orders.costo_despacho, the unique/partial-unique indexes)
// — from this domain's own backend-core-api-pedidos-pagos PR 1 (design.md
// D-A). All 6 tables spanning `ofertas`/`pedidos-pagos` are now typed here;
// `OfferItemsTable.nombre` (design.md D-B.2/D-B.4) is deliberately NOT added
// in this same PR — it lands in this change's own PR 4 alongside the
// `ofertas` mapper edit that actually populates it, so no PR in this chain
// ever leaves `offer_items`' Kysely inserts referencing a required column
// nothing yet writes (a compile-order deviation from design.md G.3's own
// prose, disclosed here rather than silently applied).

export type CompanyStatusRow = 'pendiente' | 'activo' | 'suspendido';
export type RoleRow = 'user' | 'provider' | 'admin';
export type ProfileStatusRow = 'activo' | 'suspendido';
export type AdminRoleRow = 'super_admin' | 'soporte' | 'finanzas';

export interface CompaniesTable {
  id: Generated<string>;
  razon_social: string;
  rut: string;
  giro: string;
  status: Generated<CompanyStatusRow>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ProfilesTable {
  // No `Generated<>`: this PK is the caller-supplied `auth.users.id` (uid),
  // never a DB-generated default (db-schema-identidad: `id uuid primary key
  // references auth.users (id)`).
  id: string;
  role: RoleRow;
  status: Generated<ProfileStatusRow>;
  nombre: string;
  email: string;
  telefono: string | null;
  // NULL unless role = 'provider'. The domain invariant lives in the
  // identidad use case (Phase 4a), not as a DB CHECK — see the migration's
  // column comment.
  company_id: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface AdminRolesTable {
  id: Generated<string>;
  profile_id: string;
  rol: AdminRoleRow;
  granted_by: string;
  created_at: Generated<string>;
}

export interface AuditLogTable {
  id: Generated<string>;
  actor_profile_id: string;
  accion: string;
  entity_type: string;
  entity_id: string;
  // jsonb. Shape is pinned at the `AuditLogPort`/`AuditEntry` boundary
  // (shared-audit-log spec), not here — this column is untyped `unknown`
  // on purpose, Kysely has no native jsonb-shape checking.
  cambios: Record<string, unknown>;
  motivo: string | null;
  created_at: Generated<string>;
}

export type CatalogProductStatusRow = 'activo' | 'inactivo';

export interface CatalogProductsTable {
  id: Generated<string>;
  nombre: string;
  categoria: string;
  marca: string | null;
  presentacion: string | null;
  imagen_url: string | null;
  status: Generated<CatalogProductStatusRow>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ProviderCatalogTable {
  id: Generated<string>;
  company_id: string;
  catalog_product_id: string | null;
  nombre: string;
  categoria: string;
  // node-postgres returns `numeric` as `string` (OID 1700 default parser,
  // to avoid float precision loss) — design.md D-C's gotcha. These are the
  // schema's first non-integer numeric columns, so there is no prior
  // precedent to copy: converting to `number` happens in the persistence
  // adapter's mapper, never here.
  precio_base: string;
  precio_maximo: string;
  stock: Generated<number>;
  disponible: Generated<boolean>;
  imagen_url: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface CatalogHiddenCompaniesTable {
  // No `Generated<>`: caller-supplied (the listener writes the suspended
  // company's id), never a DB-generated default.
  company_id: string;
  oculto: Generated<boolean>;
  motivo: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type OwnerTypeRow = 'self' | 'pet';
export type ConsumptionKindRow = 'medicamento' | 'alimento' | 'vacuna' | 'suplemento';

export interface PetsTable {
  id: Generated<string>;
  user_id: string;
  nombre: string;
  especie: string;
  raza: string | null;
  peso_kg: string | null; // numeric -> string (design.md's "detalle mecánico de mayor riesgo")
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface UserConsumptionTable {
  id: Generated<string>;
  user_id: string; // D15: the field that makes D7's ownership check expressible
  owner_type: OwnerTypeRow;
  pet_id: string | null;
  kind: ConsumptionKindRow;
  nombre: string;
  dosis_por_toma: string; // numeric -> string
  unidad: string | null;
  frecuencia_dias: number; // integer -> number (pg DOES parse int4)
  horarios: string[]; // text[] -> string[]
  stock_actual: string; // numeric -> string
  auto_crear_refill: boolean; // NOT NULL with no default -> not Generated
  stock_bajo_notificado_at: string | null; // D-A debounce marker
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ConsumptionLogsTable {
  id: Generated<string>;
  consumption_id: string;
  tomado_at: string;
  cantidad: string | null; // numeric -> string
  created_at: Generated<string>;
}

export type RefillUrgenciaRow = 'lo_antes_posible' | 'hoy' | 'manana' | 'en_2_3_dias';
/** Orden IDENTICO al del enum de Postgres tras el batch 14 (design.md D-A): 'borrador' primero. */
export type RefillEstadoRow = 'borrador' | 'abierta' | 'ofertada' | 'confirmada';

export interface RefillRequestsTable {
  id: Generated<string>;
  user_id: string; // D13: el campo que hace expresable el chequeo de dueño
  direccion: string | null; // D4: nullable desde el batch 15
  comuna: string | null; // D4
  urgencia: RefillUrgenciaRow; // NOT NULL sin default -> no Generated
  estado: Generated<RefillEstadoRow>; // tiene default 'abierta' -> Generated.
  // El adaptador lo escribe SIEMPRE explicito (design.md D-G.4).
  consumption_id: string | null; // design.md D-D.2. Sin FK, a proposito.
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface RefillItemsTable {
  id: Generated<string>;
  refill_request_id: string;
  catalog_product_id: string | null;
  nombre: string;
  categoria: string | null; // D4
  precio_referencia: string | null; // numeric(12,2) -> STRING, y ademas nullable.
  // Ver el callout de design.md "Number(null) === 0" — la conversion vive
  // SIEMPRE en el mapper del adaptador (adapters/persistence/), nunca acá.
  created_at: Generated<string>; // sin updated_at: refill_items es inmutable en el esquema
  // (no hay trigger), pero completarBorrador SI la actualiza — ver design.md
  // "Riesgos residuales" (la afirmación del comentario de la migración 04
  // ya no es del todo cierta; se declara ahí, no se agrega la columna acá).
}

export type OfferKindRow = 'reactiva' | 'proactiva';
export type OfferStatusRow = 'pendiente' | 'aceptada' | 'rechazada' | 'expirada';

export interface OffersTable {
  id: Generated<string>;
  user_id: string;
  refill_request_id: string | null; // NULL <=> kind = 'proactiva'
  company_id: string;
  kind: OfferKindRow;
  status: Generated<OfferStatusRow>; // tiene default 'pendiente' -> Generated.
  // El adaptador lo escribe SIEMPRE explicito (misma regla que
  // refill_requests.estado, design.md D-G's own table).
  tiempo_entrega_horas: number; // integer -> number (pg SI parsea int4)
  costo_despacho: string; // numeric(12,2) -> STRING
  total: string; // numeric(12,2) -> STRING
  mensaje: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface OfferItemsTable {
  id: Generated<string>;
  offer_id: string;
  // Dual-nullable, CHECK exactamente uno de los dos en la migracion 05
  // (offer.kind = 'reactiva' -> refill_item_id; 'proactiva' -> provider_catalog_item_id).
  refill_item_id: string | null;
  provider_catalog_item_id: string | null;
  is_alt: Generated<boolean>;
  alt_size: string | null; // numeric -> STRING, y ademas nullable
  alt_qty: string | null; // numeric -> STRING, y ademas nullable
  alt_note: string | null;
  precio: string; // numeric(12,2) -> STRING
  created_at: Generated<string>; // sin updated_at: offer_items es inmutable
}

export interface OfferOpportunitiesTable {
  refill_request_id: string; // PK provista por el caller -> sin Generated
  user_id: string;
  comuna: string;
  urgencia: RefillUrgenciaRow; // `text` en Postgres (design.md D-A.1), tipado
  // acá con la MISMA union TS que refill-matching, nunca re-declarada.
  matched_at: Generated<string>;
  cerrada_at: string | null; // la setea aceptarOferta (D12); nadie la vuelve a NULL (D-A.3)
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface OfferOpportunityCompaniesTable {
  refill_request_id: string;
  company_id: string;
  vigente: Generated<boolean>; // baja logica del reemplazo de D5 (design.md D-A.2)
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface OfferOpportunityItemsTable {
  refill_item_id: string; // PK provista por el caller
  refill_request_id: string;
  nombre: string;
  categoria: string;
  // numeric(12,2) -> STRING. NOT NULL a diferencia de refill_items.categoria/
  // .precio_referencia (nullable desde el batch 15): MatchEncontrado SOLO se
  // publica sobre una solicitud activa, y RefillRequestActiva garantiza
  // ambos campos completos — Number(row.precio_referencia) es seguro en
  // esta tabla por el contrato del evento, no por suerte (design.md's
  // "El gotcha de numeric sigue vigente" callout).
  precio_referencia: string;
  catalog_product_id: string | null;
  vigente: Generated<boolean>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type OrderStatusRow =
  'expirado' | 'pendiente_pago' | 'confirmado' | 'preparando' | 'en_camino' | 'entregado';
export type PaymentStatusRow = 'pendiente' | 'pagado' | 'fallido' | 'reembolsado';

export interface OrdersTable {
  id: Generated<string>;
  offer_id: string;
  user_id: string;
  company_id: string;
  // SIN Generated: el batch 17b DROPEA el default (design.md D-A.4). Olvidar
  // la columna en un insert es un error de COMPILACION, no un pedido
  // 'confirmado' -- pagado -- creado gratis.
  status: OrderStatusRow;
  total: string; // numeric(12,2) -> STRING
  costo_despacho: Generated<string>; // numeric(12,2) -> STRING; default 0 (design.md D-A.6)
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface OrderItemsTable {
  id: Generated<string>;
  order_id: string;
  offer_item_id: string;
  nombre: string;
  cantidad: string; // numeric -> STRING (siempre '1', design.md D-B.3)
  precio_unitario: string; // numeric(12,2) -> STRING
  subtotal: string; // numeric(12,2) -> STRING
  is_alt: Generated<boolean>;
  alt_size: string | null; // numeric -> STRING, y ademas nullable
  alt_qty: string | null; // numeric -> STRING, y ademas nullable
  alt_note: string | null;
  created_at: Generated<string>; // sin updated_at: inmutable por revocacion de grants (R6)
}

export interface PaymentsTable {
  id: Generated<string>;
  order_id: string;
  gateway: string;
  external_transaction_id: string;
  monto: string; // numeric(12,2) -> STRING
  moneda: Generated<string>; // default 'CLP'
  estado: Generated<PaymentStatusRow>; // default 'pendiente'; el adaptador lo escribe explicito igual
  // El driver lee jsonb ya parseado como objeto, pero Kysely exige `string`
  // en insert/update: hay que serializar con JSON.stringify (gotcha nuevo,
  // primera columna jsonb del repo, design.md D-G.3). raw_payload NUNCA sale
  // de adapters/persistence/ -- no esta en `Payment` de `@repon/types`. La
  // columna SI tiene default ('{}'::jsonb, migracion 06), pero se mantiene
  // SIN Generated<>: `Generated<ColumnType<...>>` produce un tipo que
  // Kysely rechaza al hacer `.set()` en un UPDATE (probado, no supuesto).
  // `crear` (Fase 3) la escribe explicita como `'{}'` en vez de confiar en
  // el default -- mismo criterio "SIEMPRE explicito" que `status`.
  raw_payload: ColumnType<unknown, string, string>;
  paid_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface DB {
  companies: CompaniesTable;
  profiles: ProfilesTable;
  admin_roles: AdminRolesTable;
  audit_log: AuditLogTable;
  catalog_products: CatalogProductsTable;
  provider_catalog: ProviderCatalogTable;
  catalog_hidden_companies: CatalogHiddenCompaniesTable;
  pets: PetsTable;
  user_consumption: UserConsumptionTable;
  consumption_logs: ConsumptionLogsTable;
  refill_requests: RefillRequestsTable;
  refill_items: RefillItemsTable;
  offers: OffersTable;
  offer_items: OfferItemsTable;
  offer_opportunities: OfferOpportunitiesTable;
  offer_opportunity_companies: OfferOpportunityCompaniesTable;
  offer_opportunity_items: OfferOpportunityItemsTable;
  orders: OrdersTable;
  order_items: OrderItemsTable;
  payments: PaymentsTable;
}
