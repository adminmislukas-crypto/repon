# Dominio: Pedidos y pagos

Se activa cuando el usuario acepta una oferta: crea el pedido, procesa el pago a través del checkout hospedado y confirma o revierte según el resultado.

## Entidades que posee

- `Order` (`status`: `confirmado` / `preparando` / `en_camino` / `entregado`)
- `OrderItem`
- `Payment` (referencia a la transacción externa — nunca datos de tarjeta)

## Puertos de entrada (casos de uso)

```ts
interface PedidosInboundPort {
  crearPedidoDesdeOferta(offerId: string): Promise<Order>          // se dispara al escuchar OfertaAceptada
  procesarWebhookPago(payload: WebhookPayload): Promise<void>
  actualizarEstadoPedido(orderId: string, status: OrderStatus): Promise<void>
}
```

## Puertos de salida

```ts
interface OrderRepository {
  save(order: Order): Promise<void>
  findById(id: string): Promise<Order | null>
}
interface PaymentGatewayPort {         // adaptador hacia Webpay Plus o MercadoPago Checkout Pro
  crearTransaccion(orderId: string, monto: number): Promise<UrlCheckout>
  verificarPago(transactionId: string): Promise<EstadoPago>
}
interface NotificationPort {
  sendPush(companyId: string, mensaje: string): Promise<void>
}
interface EventPublisher {
  publish(event: DomainEvent): Promise<void>
}
```

## Eventos que publica

- `PedidoConfirmado` — notifica al proveedor
- `PagoRecibido`
- `PagoFallido` — el pedido queda en un estado que permite reintentar sin duplicar

## Eventos que consume

- `OfertaAceptada` (de `ofertas`) — dispara `crearPedidoDesdeOferta`

## Nota de consistencia (importante en este dominio en particular)

Entre "oferta aceptada" y "pago confirmado" hay una ventana asíncrona real: el usuario puede cerrar la app antes de completar el checkout. El pedido se crea en estado `confirmado` solo después de que `PaymentGatewayPort.verificarPago` lo confirma, nunca antes — si el webhook nunca llega, el pedido queda huérfano y expira, pero no se le cobra al proveedor por un pedido que no se pagó.

## Al extraer como microservicio independiente

Es el dominio con los requisitos de confiabilidad más altos (dinero real de por medio) y el único que habla con un sistema externo crítico (la pasarela de pago). Buen candidato a aislar temprano para poder monitorearlo, reintentarlo y desplegarlo independiente del resto sin arriesgar los otros dominios si hay un incidente con la pasarela.
