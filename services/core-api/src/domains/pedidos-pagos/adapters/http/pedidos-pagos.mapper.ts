import type { EstadoPago } from '../../ports-in/obtener-estado-pago.use-case';
import type { EstadoPagoResponseDto } from './dto/estado-pago-response.dto';

/**
 * `core-api-hexagonal-layout` spec: la conversión entidad/read-model <->
 * DTO de respuesta, libre de lógica de negocio — mismo patrón que
 * `ofertas.mapper.ts`. `iniciarPago` no necesita un mapper propio: su
 * retorno (`{ checkoutUrl }`) ya coincide byte a byte con
 * `IniciarPagoResponseDto`.
 */
export function toEstadoPagoResponseDto(estadoPago: EstadoPago): EstadoPagoResponseDto {
  return {
    estado: estadoPago.estado,
    monto: estadoPago.monto,
    moneda: estadoPago.moneda,
    paidAt: estadoPago.paidAt,
  };
}
