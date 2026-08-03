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

export interface Profile {
  id: string
  role: Role
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

export interface Offer {
  id: string
  refillRequestId: string
  companyId: string
  kind: OfferKind
  items: OfferItem[]
  tiempoEntregaHoras: number
  costoDespacho: number
  total: number
  mensaje?: string
}

export interface OfferItem {
  refillItemId: string
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
- `CompanyStatus` empieza siempre en `'pendiente'` al crear una empresa nueva
