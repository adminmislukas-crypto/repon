import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PaymentStatus } from '@repon/types';

const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'pendiente',
  'pagado',
  'fallido',
  'reembolsado',
];

/**
 * `GET /pedidos/:orderId/pago` (200, design.md D-E). Deliberadamente
 * angosto: `raw_payload`/`external_transaction_id`/`gateway` NUNCA viajan
 * acá — ninguno de los tres tiene valor para el cliente, y el primero es
 * un detalle interno de auditoría del lado del gateway.
 */
export class EstadoPagoResponseDto {
  @ApiProperty({ enum: PAYMENT_STATUSES })
  estado!: PaymentStatus;

  @ApiProperty()
  monto!: number;

  @ApiProperty()
  moneda!: string;

  @ApiPropertyOptional({ description: 'Presente únicamente cuando estado === "pagado".' })
  paidAt?: string;
}
