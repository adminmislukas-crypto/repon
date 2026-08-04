import type { Generated } from 'kysely';

// Kysely row types (`snake_case`, matches Postgres columns 1:1) for the
// tables this change's scope touches — `profiles`/`companies`/`admin_roles`
// (identidad's first three tables) plus `audit_log` (shared kernel).
//
// design.md D-A's non-negotiable boundary: these row types never cross into
// `@repon/types` (which stays `camelCase`, domain-shaped) and never leave
// `shared/database/` + `adapters/persistence/` — the only two places
// allowed to know what a Postgres row actually looks like. The remaining
// 13 tables (`catalogo`/`consumo`/`refill-matching`/`ofertas`/
// `pedidos-pagos`) get typed here as their owning domain change lands
// (Phase 4a onward, tasks.md), not upfront.
//
// Source of truth for every column below:
// supabase/migrations/20260803120100_01a_identidad_core.sql (companies,
// profiles), .../20260803120110_01b_identidad_admin.sql (admin_roles),
// .../20260803120700_07_auditoria.sql (audit_log) — from the archived
// `backend-supabase-migrations` change.

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

export interface DB {
  companies: CompaniesTable;
  profiles: ProfilesTable;
  admin_roles: AdminRolesTable;
  audit_log: AuditLogTable;
}
