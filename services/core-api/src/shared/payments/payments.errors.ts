/**
 * Errores del kernel compartido `shared/payments/` (design.md D-C.2, D-E).
 * Importados desde `pedidos-pagos` sin redeclarar — mismo patrón que
 * `CatalogQueryUnavailableError` en `ofertas`. `FirmaInvalidaError`
 * (Fase 6b) se agrega acá también más adelante: ambas las lanza el
 * ADAPTADOR de la pasarela, nunca un caso de uso de `pedidos-pagos`.
 */

/**
 * Mapea a 503 `PASARELA_NO_CONFIGURADA` (design.md D-E). Lanzado por
 * `PasarelaNoConfiguradaAdapter` — cada método de `PaymentGatewayPort`
 * rechaza con esta clase cuando no hay credenciales de pasarela
 * configuradas. NO es un error de arranque: la app bootea igual (D-C.2),
 * y este es el modo de falla explícito en runtime.
 */
export class PasarelaNoConfiguradaError extends Error {
  constructor(credencialFaltante: string) {
    super(`La pasarela de pago no está configurada: falta ${credencialFaltante}.`);
    this.name = 'PasarelaNoConfiguradaError';
  }
}
