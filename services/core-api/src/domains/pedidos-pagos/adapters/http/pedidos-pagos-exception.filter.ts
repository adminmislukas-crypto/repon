import {
  Catch,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { PasarelaNoConfiguradaError } from '../../../../shared/payments/payments.errors';
import {
  PagoNoEncontradoError,
  PedidoNoEncontradoError,
  PedidoNoPagableError,
  TransicionInvalidaError,
} from '../../domain/pedido.errors';

interface ResponseLike {
  status(code: number): { json(body: unknown): void };
}

interface StatusAndCode {
  statusCode: number;
  code: string;
}

type ErrorConstructor = new (...args: never[]) => Error;

/**
 * `domain/pedido.errors.ts`'s per-class doc comments + design.md D-E's
 * "Errores de dominio" table — mismo patrón (lookup por constructor, nunca
 * una cadena de `instanceof`) que `OfertasExceptionFilter`/
 * `RefillExceptionFilter`/`ConsumoExceptionFilter`/`CatalogoExceptionFilter`.
 *
 * `PedidoInvalidoError`/`PedidoYaExisteError` (`domain/pedido.errors.ts`)
 * NO están acá: el primero solo lo lanza `crearPedidoDesdeOferta`
 * (listener, sin ruta HTTP — nunca llega a este filtro); el segundo es una
 * señal interna que nunca sale de `KyselyOrderRepository.crear` (D-F). Ninguno
 * de los dos puede propagarse por ninguna ruta de este PR.
 *
 * `PasarelaNoConfiguradaError` (`shared/payments/payments.errors.ts`) se
 * importa sin redeclarar (mismo patrón que `CatalogQueryUnavailableError`
 * en `ofertas`) — la lanza `PasarelaNoConfiguradaAdapter` dentro de
 * `iniciarPago`, alcanzable YA en este PR (el binding "no configurado" es
 * el único que existe hasta la Fase 6a).
 *
 * `@Catch()` lista las 5 clases de este PR; `FirmaInvalidaError`
 * (Fase 6b) se agrega cuando `procesarWebhookPago` exista.
 */
const ERROR_STATUS_MAP = new Map<ErrorConstructor, StatusAndCode>([
  [PedidoNoEncontradoError, { statusCode: HttpStatus.NOT_FOUND, code: 'PEDIDO_NO_ENCONTRADO' }],
  [TransicionInvalidaError, { statusCode: HttpStatus.CONFLICT, code: 'TRANSICION_INVALIDA' }],
  [PedidoNoPagableError, { statusCode: HttpStatus.CONFLICT, code: 'PEDIDO_NO_PAGABLE' }],
  [PagoNoEncontradoError, { statusCode: HttpStatus.NOT_FOUND, code: 'PAGO_NO_ENCONTRADO' }],
  [
    PasarelaNoConfiguradaError,
    { statusCode: HttpStatus.SERVICE_UNAVAILABLE, code: 'PASARELA_NO_CONFIGURADA' },
  ],
]);

@Catch(
  PedidoNoEncontradoError,
  TransicionInvalidaError,
  PedidoNoPagableError,
  PagoNoEncontradoError,
  PasarelaNoConfiguradaError,
)
export class PedidosPagosExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PedidosPagosExceptionFilter.name);

  catch(exception: Error, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ResponseLike>();
    const { statusCode, code } = ERROR_STATUS_MAP.get(
      exception.constructor as ErrorConstructor,
    ) ?? {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
    };
    if (statusCode >= 500) this.logger.error(exception.stack);
    response.status(statusCode).json({ statusCode, code, message: exception.message });
  }
}
