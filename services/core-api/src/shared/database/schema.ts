import type { Generated } from 'kysely';

// Kysely row types (`snake_case`, matches Postgres columns 1:1) for the
// tables this change's scope touches — `profiles`/`companies`/`admin_roles`
// (identidad's first three tables), `audit_log` (shared kernel), plus
// `catalog_products`/`provider_catalog`/`catalog_hidden_companies`
// (catalogo, backend-core-api-catalogo PR 1) and `pets`/`user_consumption`/
// `consumption_logs` (consumo, backend-core-api-consumo PR 1).
//
// design.md D-A's non-negotiable boundary: these row types never cross into
// `@repon/types` (which stays `camelCase`, domain-shaped) and never leave
// `shared/database/` + `adapters/persistence/` — the only two places
// allowed to know what a Postgres row actually looks like. The remaining
// 8 tables (`refill-matching`/`ofertas`/`pedidos-pagos`) get typed here as
// their owning domain change lands, not upfront.
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
// backend-core-api-consumo PR 1 (design.md D-A/D12).

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
}
