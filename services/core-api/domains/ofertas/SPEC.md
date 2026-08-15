# Dominio: Ofertas

Proveedores ofertando sobre una solicitud de refill, reactiva o proactivamente, incluyendo la lógica de presentación alternativa (cuando el proveedor no tiene exactamente lo pedido).

## Entidades que posee

- `Offer` (`kind`: `reactiva` | `proactiva`)
- `OfferItem` (con `isAlt`, `altSize`, `altQty`, `altNote` — ver `packages/types/SPEC.md`)

## Puertos de entrada (casos de uso)

Todas las firmas de abajo son **conceptuales** (dominio, no DTO de HTTP): `companyId` como dueño y `userId` como aceptante/consultante nunca llegan como campo de un DTO de cliente — el controller los deriva siempre del actor autenticado (`actor.companyId` / `actor.profileId`), jamás de un parámetro del body o query (delta `backend-core-api-ofertas`, D11).

```ts
interface OfertasInboundPort {
  enviarOferta(companyId: string, refillRequestId: string, items: NuevoOfferItem[], entrega: DatosEntrega): Promise<Offer>
  enviarOfertaProactiva(companyId: string, userId: string, items: NuevoOfferItem[], entrega: DatosEntrega, mensaje?: string): Promise<Offer>
  aceptarOferta(offerId: string, userId: string): Promise<void>
  obtenerBandeja(userId: string): Promise<Offer[]>
}
```

`enviarOfertaProactiva`'s `userId` es la **única excepción del repo**: viaja en el DTO del cliente porque identifica al **destinatario** de la oferta, no al dueño del recurso que ejecuta la acción — pero no es libre. Acotado por D10: solo puede dirigirse a un `userId` con el que la empresa **ya tiene relación**, verificada contra la proyección de descubrimiento de `MatchEncontrado` (existe al menos una oportunidad de ese usuario en la que esta `companyId` figura como elegible). Sin relación previa, **404** — nunca 403, mismo criterio de D11 de no filtrar existencia cross-tenant a través del código de estado (delta `backend-core-api-ofertas`, D10).

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
```

`NotificationPort`/`EventPublisher` **no se re-declaran aquí** (delta `backend-core-api-ofertas`, D17): viven en el kernel compartido — el propio `notification.port.ts` documenta que "lives in the shared kernel even though `consumo`/`ofertas`/`pedidos-pagos`'s own SPEC.md list it among their ports-out — push notifications are shared infra". `sendPush`/`publish` se invocan desde el caso de uso mismo, best-effort y en el mismo cuerpo que la escritura, nunca desde un listener intermedio — mismo precedente literal que `procesarConsumosVencidos` de `consumo` ya estableció.

## Eventos que publica

- `OfertaEnviada` — dispara notificación push al usuario
- `OfertaAceptada` — lo escucha `pedidos-pagos` para crear el pedido

## Eventos que consume

- `MatchEncontrado` (de `refill-matching`) — alimenta la proyección de descubrimiento (`offer_opportunities`/`offer_opportunity_companies`/`offer_opportunity_items`): cada evento **reemplaza** el conjunto de empresas e ítems elegibles para esa solicitud. Suscripción por nombre de canal string (`'refill.match_encontrado'`), nunca importando la clase de evento de `refill-matching` (delta `backend-core-api-ofertas`, D2).
- `RefillCreado` **queda explícitamente fuera de alcance** — se emite hoy y este dominio deliberadamente no lo escucha. No lleva `companyIds`; sin ese campo no hay hecho de elegibilidad que proyectar, y suscribirse igual crearía una fila de oportunidad con cero empresas elegibles por cada solicitud creada, incluidas las que nunca se matchearon. `MatchEncontrado` cubre el mismo caso "buscamos y no hay nadie": se publica también con `companyIds: []` (delta `backend-core-api-ofertas`, D2).

**Corrección de una conflación previa**: una versión anterior de esta sección describía a `MatchEncontrado` como disparador de "la oferta automática si el proveedor tiene auto-oferta activada". Eso conflaba dos mecanismos distintos: (a) la proyección de descubrimiento de arriba, donde un proveedor humano navega y decide, y (b) la creación automática de ofertas, donde el sistema decide por él. Este dominio construye únicamente (a). La auto-oferta (b) **queda fuera de alcance**: no existe columna `auto_oferta` en ninguna migración del repo, y `docs/ROADMAP.md` la ubica en **Fase 6 — Automatización** ("Ofertas proactivas automáticas para proveedores con auto-oferta activada"), separada de la Fase 4 ("Bandeja de ofertas con Supabase Realtime") que es lo que este cambio habilita. Cuando llegue, será aditiva sobre esta misma proyección (delta `backend-core-api-ofertas`, D3).

## Al extraer como microservicio independiente

Es, junto con `pedidos-pagos`, el dominio con más carga de escritura en horas pico (múltiples proveedores ofertando sobre la misma solicitud casi simultáneamente). Buen candidato a extraer temprano si el volumen de proveedores activos crece rápido.
