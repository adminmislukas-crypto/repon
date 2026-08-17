import { ScreenStub } from '@/components/ScreenStub';

/** SPEC.md `s-pago-ok` — confirmación de pago, número de pedido, estado del despacho. */
export default function PagoOkScreen() {
  return (
    <ScreenStub
      title="Pago confirmado"
      description="Número de pedido y estado del despacho — llega solo después de que el webhook confirma."
    />
  );
}
