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
