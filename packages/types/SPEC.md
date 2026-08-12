# packages/types

Tipos TypeScript compartidos entre `usuario-mobile`, `proveedor-mobile`, `admin-web`, y el dominio de `core-api`.

**Este archivo documenta el código en `packages/types/src/**` — ya no es la fuente ejecutable.** El `.ts` real es la fuente única de verdad de las formas de entidad (`shared-types-package` spec, Requirement "@repon/types is a real, importable workspace package"); si un campo cambia, cambia primero en `src/`, y este archivo se actualiza para reflejarlo. También deben reflejar exactamente las tablas de `supabase/SPEC.md` — si un campo cambia en la base de datos, cambia en `src/` primero.

## Organización del código

| Archivo | Exporta |
|---|---|
| `src/identidad.ts` | `Role`, `CompanyStatus`, `ProfileStatus`, `AdminRole`, `Company`, `CompanyDispatchZone`, `Profile` |
| `src/consumo.ts` | `OwnerType`, `ConsumptionKind`, `Pet`, `UserConsumption` (delta `backend-core-api-consumo`, D15 — gana `userId: string`), `ConsumptionLog` |
| `src/catalogo.ts` | `CatalogProductStatus`, `CatalogProduct`, `ProviderCatalogItem`, `NuevoProductoProveedor`, `FilaCarga`, `ArchivoCarga`, `ResultadoCargaMasiva` (últimos 4: delta `backend-core-api-catalogo`, D12 — promovidos desde prosa de `catalogo/SPEC.md` a código real, mismo tratamiento que `shared-types-package` ya hizo para los otros 7 archivos en `backend-core-api-foundation`) |
| `src/refill-matching.ts` | `Urgencia`, `RefillEstado`, `RefillEstadoActivo`, `RefillItem`, `RefillItemBorrador`, `RefillRequest` (+ variantes `RefillRequestBorrador`/`RefillRequestActiva`), `NuevoRefillItem` (delta `backend-core-api-refill-matching`, D11/D-B — `RefillRequest` es ahora una unión discriminada sobre `estado`; `RefillItem` conserva su forma exacta de siempre para no romper la firma congelada de `CatalogQueryPort` en `catalogo`) |
| `src/ofertas.ts` | `OfferKind`, `OfferStatus`, `OfferItem` (+ variantes `OfferItemReactiva`/`OfferItemProactiva`/`OfferItemAlt`), `Offer` |
| `src/pedidos-pagos.ts` | `OrderStatus`, `Order`, `OrderItem`, `PaymentStatus`, `Payment` |
| `src/audit.ts` | `AuditLog` (infraestructura compartida, no es entidad de un dominio) |
| `src/index.ts` | Barrel export — `import { ... } from '@repon/types'` |

**Regla de borde (D-A, no negociable)**: los tipos de fila generados por Kysely (`snake_case`, `services/core-api/src/shared/database/schema.ts`) NUNCA se exportan desde `@repon/types`. Este paquete solo expone formas `camelCase` de dominio — el cast vive únicamente en `shared/database` y `adapters/persistence` de `core-api`.

**Sin paso de build**: `package.json` apunta `exports`/`types` directo a `src/index.ts` — es un paquete de tipos puros, cero código en runtime. El único check en CI es `tsc --noEmit` (`typecheck`).

## Reglas de validación que deben vivir en el tipo, no solo en el formulario

Estado real de cada regla en el código (`shared-types-package` spec, Requirement "Validation rules documented in SPEC.md live in the type/DTO, not only the form"):

- **Enforced by un union type hoy** (`src/ofertas.ts`):
  - `OfferItem.altNote` obligatorio cuando `isAlt === true` — `OfferItemAlt` discrimina en `isAlt`.
  - `OfferItem` siempre tiene exactamente uno de `refillItemId`/`providerCatalogItemId`, nunca ambos, nunca ninguno — `OfferItemReactiva`/`OfferItemProactiva` usan `?: never` en el campo excluido.
  - `Offer.refillRequestId` presente solo si `kind === 'reactiva'` — `Offer` es una unión discriminada en `kind`, con `items` acotado a la variante de `OfferItem` correspondiente.
- **Enforced por un tuple type no-vacío hoy** (`src/consumo.ts`): `UserConsumption.horarios` tipado `[string, ...string[]]` — siempre al menos 1 elemento.
- **Documentado, deliberadamente NO forzado a nivel estructural** (comentario TSDoc en el campo, valor original preservado — forzarlo cambiaría el significado del campo en lecturas ya existentes de filas en cualquier estado):
  - `ConsumptionLog` no expone `createdAt` — mismo patrón que `Company`/`Profile`.
  - `ProviderCatalogItem.catalogProductId` / `RefillItem.catalogProductId` opcionales a propósito (Q4).
  - `RefillRequestActiva.comuna`/`direccion` siempre requeridos; `RefillRequestBorrador.comuna`/`direccion` opcionales — corrección declarada (delta `backend-core-api-refill-matching`, D3/D4): ya no existe un único `RefillRequest.comuna` universal "siempre requerido" como decía una versión anterior de esta fila, porque `RefillRequest` es ahora una unión discriminada sobre `estado` (D-B) y solo la variante activa exige completitud.
  - `CatalogProduct` no filtra por `status` en el tipo (Q6).
- **Diferido a la capa de dominio de `services/core-api` — no es trabajo de este paquete** (invariantes de creación/transición sobre valores que son válidos en reposo en cualquier estado; enforced por factories/casos de uso, Fase 4a/4b de `backend-core-api-foundation`, no construidos todavía):
  - `CompanyStatus` empieza siempre en `'pendiente'` al crear una empresa.
  - `ProfileStatus` empieza siempre en `'activo'`, transiciona a `'suspendido'` vía `suspenderUsuario`/`suspenderEmpresa` — nunca se borra el registro.
  - `OfferStatus` empieza siempre en `'pendiente'`; transiciona a `'aceptada'` vía `aceptarOferta` (con displacement de las demás ofertas `'pendiente'` de la misma `refillRequestId` a `'rechazada'` — el único disparador de `'rechazada'` hoy, `db-schema-ofertas` lote `05`); `'expirada'` soportada por el esquema, sin caso de uso que la dispare todavía.
  - `Offer.userId` debe coincidir con el `userId` de su `RefillRequest` cuando `refillRequestId` está presente — invariante cruzada entre entidades, vive en el caso de uso de `ofertas`, no expresable en un tipo estático (no hay dependent types en TS).
