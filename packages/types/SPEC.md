# packages/types

Tipos TypeScript compartidos entre `usuario-mobile`, `proveedor-mobile` y `admin-web`. Deben reflejar exactamente las tablas de `supabase/SPEC.md` — si un campo cambia en la base de datos, cambia aquí primero.

## Tipos base

```ts
export type Role = 'user' | 'provider' | 'admin'
export type CompanyStatus = 'pendiente' | 'activo' | 'suspendido'
export type OwnerType = 'self' | 'pet'
export type ConsumptionKind = 'medicamento' | 'alimento' | 'vacuna' | 'suplemento'
export type OfferKind = 'reactiva' | 'proactiva'
export type OrderStatus = 'confirmado' | 'preparando' | 'en_camino' | 'entregado'
export type AdminRole = 'super_admin' | 'soporte' | 'finanzas'

export type ProfileStatus = 'activo' | 'suspendido'

export interface Company {
  id: string
  razonSocial: string
  rut: string
  giro: string
  status: CompanyStatus
}

export interface CompanyDispatchZone {
  id: string
  companyId: string
  comuna: string
  region: string
}

export interface Profile {
  id: string
  role: Role
  status: ProfileStatus
  nombre: string
  email: string
  telefono?: string
  companyId?: string // solo si role === 'provider'
}

export interface Pet {
  id: string
  userId: string
  nombre: string
  especie: string
  raza?: string
  pesoKg?: number
}

export interface UserConsumption {
  id: string
  ownerType: OwnerType
  petId?: string
  kind: ConsumptionKind
  nombre: string
  dosisPorToma: number
  unidad?: string
  frecuenciaDias: number
  horarios: string[] // "HH:mm"
  stockActual: number
  autoCrearRefill: boolean
}

export interface RefillRequest {
  id: string
  userId: string
  items: RefillItem[]
  direccion: string
  urgencia: 'lo_antes_posible' | 'hoy' | 'manana' | 'en_2_3_dias'
  estado: 'abierta' | 'ofertada' | 'confirmada'
}

export interface RefillItem {
  id: string
  nombre: string
  categoria: string
  precioReferencia: number
}

export type OfferStatus = 'pendiente' | 'aceptada' | 'rechazada' | 'expirada'

export interface Offer {
  id: string
  userId: string // destinatario; requerido siempre, incl. ofertas proactivas sin refillRequestId
  refillRequestId?: string // ausente cuando kind === 'proactiva'
  companyId: string
  kind: OfferKind
  status: OfferStatus
  items: OfferItem[]
  tiempoEntregaHoras: number
  costoDespacho: number
  total: number
  mensaje?: string
}

export interface OfferItem {
  refillItemId?: string          // presente solo si la Offer padre es kind === 'reactiva'
  providerCatalogItemId?: string // presente solo si la Offer padre es kind === 'proactiva'
  isAlt: boolean
  altSize?: number   // ej. 25 (kg) o 15 (unidades)
  altQty?: number     // ej. 1 saco, o 2 cajas
  altNote?: string     // texto explicativo mostrado al usuario
  precio: number
}

export interface Order {
  id: string
  offerId: string
  userId: string
  companyId: string
  status: OrderStatus
  total: number
}
```

## Reglas de validación que deben vivir en el tipo, no solo en el formulario

- `OfferItem.altNote` es obligatorio cuando `isAlt === true` — nunca se envía una presentación alternativa sin explicación
- `UserConsumption.horarios` siempre tiene al menos 1 elemento
- `Offer.refillRequestId` presente siempre que `kind === 'reactiva'`, ausente cuando `kind === 'proactiva'`. Cuando está presente, `Offer.userId` DEBE coincidir con el `userId` de esa `RefillRequest` — invariante que vive en el caso de uso de `ofertas`, no en la DB
- `OfferItem` siempre tiene exactamente uno de `refillItemId` (si la oferta es `reactiva`) o `providerCatalogItemId` (si es `proactiva`) — nunca ambos, nunca ninguno
- `CompanyStatus` empieza siempre en `'pendiente'` al crear una empresa nueva
- `ProfileStatus` empieza siempre en `'activo'` al crear un usuario nuevo; transiciona a `'suspendido'` vía `suspenderUsuario`/`suspenderEmpresa` (dominio `identidad`) — nunca se borra el registro
- `OfferStatus` empieza siempre en `'pendiente'` al crearse (`enviarOferta`/`enviarOfertaProactiva`); transiciona a `'aceptada'` vía `aceptarOferta`. **Pendiente de definir en `sdd-spec`**: el dominio `ofertas` aún no expone casos de uso para `'rechazada'`/`'expirada'` — se agregaron los estados para no violar la regla de "nunca borrado físico, todo pasa por status" de `docs/ARCHITECTURE.md`, pero falta la lógica de negocio que dispare esas transiciones (ej. qué pasa con las demás ofertas cuando una es aceptada)
