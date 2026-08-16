import { ApiProperty } from '@nestjs/swagger';

/** `POST /pedidos/:orderId/pago` (201, design.md D-E). Sin request body: el
 *  monto SIEMPRE sale de `orders.total`, nunca del cliente. */
export class IniciarPagoResponseDto {
  @ApiProperty({ description: 'URL de checkout hospedado de la pasarela.' })
  checkoutUrl!: string;
}
