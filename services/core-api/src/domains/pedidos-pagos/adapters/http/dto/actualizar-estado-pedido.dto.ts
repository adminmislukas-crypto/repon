import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { EstadoProveedor } from '../../../ports-in/actualizar-estado-pedido.use-case';

/**
 * `PATCH /pedidos/:orderId/estado` (design.md D-E). **NO acepta**
 * `'confirmado'`, `'pendiente_pago'` ni `'expirado'` — los 3 son
 * inalcanzables por el proveedor (D-A.2), y esta validación de DTO es la
 * PRIMERA barrera (400 antes que 409): sin ella, un provider podría
 * apuntar a `'confirmado'` en el mismo `orderId` que el camino de
 * confirmación de pago legítimamente transiciona, y la máquina de estados
 * pura (Fase 2) por sí sola no puede distinguir quién la está llamando.
 */
const ESTADOS_PROVEEDOR: readonly EstadoProveedor[] = ['preparando', 'en_camino', 'entregado'];

export class ActualizarEstadoPedidoDto {
  @ApiProperty({ enum: ESTADOS_PROVEEDOR })
  @IsIn(ESTADOS_PROVEEDOR)
  estado!: EstadoProveedor;
}
