import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Actor } from '../../../../shared/auth/decorators/actor.decorator';
import { Roles } from '../../../../shared/auth/decorators/roles.decorator';
import type { AuthenticatedActor } from '../../../../shared/auth/ports/actor.port';
import { ActualizarEstadoPedidoUseCase } from '../../ports-in/actualizar-estado-pedido.use-case';
import { IniciarPagoUseCase } from '../../ports-in/iniciar-pago.use-case';
import { ObtenerEstadoPagoUseCase } from '../../ports-in/obtener-estado-pago.use-case';
import { ActualizarEstadoPedidoDto } from './dto/actualizar-estado-pedido.dto';
import { EstadoPagoResponseDto } from './dto/estado-pago-response.dto';
import { IniciarPagoResponseDto } from './dto/iniciar-pago-response.dto';
import { toEstadoPagoResponseDto } from './pedidos-pagos.mapper';
import { PedidosPagosExceptionFilter } from './pedidos-pagos-exception.filter';

/**
 * design.md D-E's "Superficie HTTP" table. **Dos controladores, a
 * propósito** (D-E): el webhook `@Public()` de la pasarela (Fase 6b) vive
 * en `pagos.controller.ts`, un archivo aparte, para que el radio de
 * explosión de `@Public()` nunca conviva con una ruta JWT en el mismo
 * archivo. `orders`/`order_items` no llevan ruta de lectura acá — son
 * legibles directo por RLS (`docs/ARCHITECTURE.md`).
 *
 * `POST`/`GET /pedidos/:orderId/pago`: `@Roles('user')` + dueño
 * (`actor.profileId`, verificado dentro de cada caso de uso vía
 * `order.userId`). `PATCH /pedidos/:orderId/estado`: `@Roles('provider')`
 * + empresa dueña (`actor.companyId!`, non-null enforced por el guard —
 * mismo patrón que `OfertasController`).
 */
@ApiTags('pedidos')
@ApiBearerAuth()
@Controller('pedidos')
@UseFilters(PedidosPagosExceptionFilter)
export class PedidosController {
  constructor(
    private readonly iniciarPagoUseCase: IniciarPagoUseCase,
    private readonly obtenerEstadoPagoUseCase: ObtenerEstadoPagoUseCase,
    private readonly actualizarEstadoPedidoUseCase: ActualizarEstadoPedidoUseCase,
  ) {}

  /** Sin `@Body()`: el DTO de esta ruta no existe — el monto SIEMPRE sale
   *  de `orders.total`, nunca del cliente (design.md D-D/D-E). */
  @Roles('user')
  @Post(':orderId/pago')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'El dueño del pedido inicia (o reintenta) un pago contra la pasarela hospedada ' +
      '(design.md Diagrama 2).',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiCreatedResponse({ type: IniciarPagoResponseDto })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es user.' })
  @ApiNotFoundResponse({
    description: 'El pedido no existe, o es de otro usuario — mismo 404, byte a byte (D4).',
  })
  @ApiConflictResponse({ description: 'El pedido no está en pendiente_pago.' })
  @ApiServiceUnavailableResponse({ description: 'La pasarela de pago no está configurada.' })
  async iniciarPago(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Actor() actor: AuthenticatedActor,
  ): Promise<IniciarPagoResponseDto> {
    return this.iniciarPagoUseCase.execute(actor.profileId, orderId);
  }

  @Roles('user')
  @Get(':orderId/pago')
  @ApiOperation({
    summary: 'Estado local del intento de pago más reciente del pedido (design.md D-E).',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiOkResponse({ type: EstadoPagoResponseDto })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es user.' })
  @ApiNotFoundResponse({
    description: 'El pedido no existe/es de otro usuario, o nunca se llamó a iniciarPago para él.',
  })
  async obtenerEstadoPago(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Actor() actor: AuthenticatedActor,
  ): Promise<EstadoPagoResponseDto> {
    const estadoPago = await this.obtenerEstadoPagoUseCase.execute(actor.profileId, orderId);
    return toEstadoPagoResponseDto(estadoPago);
  }

  @Roles('provider')
  @Patch(':orderId/estado')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'La empresa dueña del pedido avanza su ciclo de vida (design.md D-A.2) — monótono, sin ' +
      'retroceso, nunca alcanza confirmado/pendiente_pago/expirado.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es provider.' })
  @ApiNotFoundResponse({
    description: 'El pedido no existe, o es de otra empresa — mismo 404, byte a byte (D4).',
  })
  @ApiConflictResponse({
    description: 'La transición no es adyacente, es hacia atrás, o el origen/destino es terminal.',
  })
  async actualizarEstadoPedido(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: ActualizarEstadoPedidoDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<void> {
    await this.actualizarEstadoPedidoUseCase.execute(actor.companyId!, orderId, dto.estado);
  }
}
