import type { PaymentGatewayPort } from './payment-gateway.port';
import { PasarelaNoConfiguradaAdapter } from './pasarela-no-configurada.adapter';
import { PasarelaNoConfiguradaError } from './payments.errors';

// Tipado como `PaymentGatewayPort`, no como la clase concreta: el
// adaptador declara sus métodos SIN parámetros a propósito (structural
// typing, ver el propio comentario del adaptador) — llamarlo con los
// argumentos reales del puerto solo typechequea contra la interfaz.
function buildAdapter(): PaymentGatewayPort {
  return new PasarelaNoConfiguradaAdapter();
}

// design.md D-C.2: "no es andamio, es la rama permanente". Cada método
// rechaza explícitamente en vez de dejar que Nest arranque con un puerto
// mudo — el criterio de éxito es que el PROCESO bootea igual (verificado en
// pedidos-pagos' propio e2e, no acá; este archivo solo prueba el adaptador
// en aislamiento).
describe('PasarelaNoConfiguradaAdapter', () => {
  it('crearTransaccion rejects with PasarelaNoConfiguradaError', async () => {
    const adapter = buildAdapter();

    await expect(adapter.crearTransaccion('order-1', 14990)).rejects.toThrow(
      PasarelaNoConfiguradaError,
    );
  });

  it('verificarPago rejects with PasarelaNoConfiguradaError', async () => {
    const adapter = buildAdapter();

    await expect(adapter.verificarPago('txn-1')).rejects.toThrow(PasarelaNoConfiguradaError);
  });

  it('never resolves — both methods always reject, no happy path exists', async () => {
    const adapter = buildAdapter();

    await expect(adapter.crearTransaccion('order-1', 14990)).rejects.toBeInstanceOf(Error);
    await expect(adapter.verificarPago('txn-1')).rejects.toBeInstanceOf(Error);
  });
});
