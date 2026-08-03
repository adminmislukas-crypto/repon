# Dominio: Ofertas

Proveedores ofertando sobre una solicitud de refill, reactiva o proactivamente, incluyendo la lógica de presentación alternativa (cuando el proveedor no tiene exactamente lo pedido).

## Entidades que posee

- `Offer` (`kind`: `reactiva` | `proactiva`)
- `OfferItem` (con `isAlt`, `altSize`, `altQty`, `altNote` — ver `packages/types/SPEC.md`)

## Puertos de entrada (casos de uso)

```ts
interface OfertasInboundPort {
  enviarOferta(companyId: string, refillRequestId: string, items: NuevoOfferItem[], entrega: DatosEntrega): Promise<Offer>
  enviarOfertaProactiva(companyId: string, userId: string, items: NuevoOfferItem[], mensaje?: string): Promise<Offer>
  aceptarOferta(offerId: string, userId: string): Promise<void>
  obtenerBandeja(userId: string): Promise<Offer[]>
}
```

Regla de negocio que vive aquí, no en el cliente: **si `isAlt === true`, `altNote` es obligatorio** — nunca se acepta una oferta con presentación distinta sin explicación. El cálculo del precio por unidad/kilo para comparar contra la referencia también es una función de dominio pura, no del formulario de la app.

### Invariante `offers.user_id` vs `refill_requests.user_id` (lote 05, `db-schema-ofertas`)

`offers.user_id` (destinatario) es una columna física, denormalizada y `NOT NULL` — no derivada de `refill_requests.user_id` vía join. Es la única forma de que una oferta proactiva (`kind === 'proactiva'`, sin `refillRequestId`) tenga un dueño legible por RLS: no existe fila de `refill_requests` de la cual derivar la propiedad. Regla enforceada aquí, no en Postgres (ni CHECK ni trigger): **cuando `refillRequestId` está presente** (`kind === 'reactiva'`), `enviarOferta` DEBE setear `offers.user_id` igual a `refill_requests.user_id` de la solicitud referenciada — divergencia entre ambas columnas es un bug del caso de uso, no un estado válido. `enviarOfertaProactiva` setea `offers.user_id` directamente al destinatario elegido por el proveedor, sin pasar por `refill_requests` en absoluto.

### Displacement a `'rechazada'` al aceptar una oferta

`aceptarOferta(offerId, userId)` hace dos cosas dentro de la misma operación, no dos casos de uso separados:

1. Transiciona la `offer` elegida (`offerId`) a `status = 'aceptada'`.
2. Transiciona **todas las demás** ofertas `'pendiente'` que compartan el mismo `refillRequestId` a `status = 'rechazada'`.

Esto resuelve la pregunta abierta original de `sdd-propose`/`design.md` sobre qué dispara `'rechazada'`: no es un caso de uso propio (no hay `rechazarOferta`), es un efecto secundario obligatorio de aceptar una oferta hermana. Para ofertas proactivas (`refillRequestId IS NULL`) no hay hermanas que desplazar por definición — el displacement solo aplica al flujo reactivo, donde múltiples proveedores pueden ofertar sobre la misma solicitud. La unicidad de `'aceptada'` por `refillRequestId` la enforce, en paralelo, el índice único parcial `offers_refill_request_id_aceptada_uidx` (`supabase/migrations/20260803120500_05_ofertas.sql`) — si el displacement de `core-api` tuviera un bug de concurrencia, ese índice es el último cerrojo que evita dos ofertas `'aceptada'` simultáneas para la misma solicitud.

## Puertos de salida

```ts
interface OfferRepository {
  save(offer: Offer): Promise<void>
  findByUser(userId: string): Promise<Offer[]>
  findByRefillRequest(refillRequestId: string): Promise<Offer[]>
}
interface NotificationPort {
  sendPush(userId: string, mensaje: string): Promise<void>
}
interface EventPublisher {
  publish(event: DomainEvent): Promise<void>
}
```

## Eventos que publica

- `OfertaEnviada` — dispara notificación push al usuario
- `OfertaAceptada` — lo escucha `pedidos-pagos` para crear el pedido

## Eventos que consume

- `RefillCreado` + `MatchEncontrado` (de `refill-matching`) — dispara la oferta automática si el proveedor tiene auto-oferta activada y el producto está en su catálogo

## Al extraer como microservicio independiente

Es, junto con `pedidos-pagos`, el dominio con más carga de escritura en horas pico (múltiples proveedores ofertando sobre la misma solicitud casi simultáneamente). Buen candidato a extraer temprano si el volumen de proveedores activos crece rápido.
