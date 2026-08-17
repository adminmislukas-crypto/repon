import { ScreenStub } from '@/components/ScreenStub';

/**
 * SPEC.md `s-pago` — el formulario de tarjeta del mockup es solo
 * representativo. En producción este paso se reemplaza por el checkout
 * hospedado de `pedidos-pagos` (`POST /pedidos/:orderId/pago` →
 * `checkoutUrl`) — esta app nunca captura ni transmite el número de
 * tarjeta.
 */
export default function PagoScreen() {
  return (
    <ScreenStub
      title="Pagar pedido"
      description="Redirige al checkout hospedado de la pasarela — esta app nunca toca datos de tarjeta."
    />
  );
}
