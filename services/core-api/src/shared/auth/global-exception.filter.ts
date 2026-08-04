import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
}

interface ResponseLike {
  status(code: number): { json(body: unknown): void };
}

function isErrorBody(payload: unknown): payload is ErrorBody {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'statusCode' in payload &&
    'code' in payload &&
    'message' in payload
  );
}

/**
 * `core-api-auth-guard` spec, "A global exception filter emits stable error
 * codes": every thrown exception — a guard rejection or anything else —
 * becomes `{ statusCode, code, message }`. No stack trace, no internal
 * error detail ever reaches the response body; 5xx bodies still get logged
 * server-side for diagnosis.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ResponseLike>();
    const body = this.toErrorBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }
    response.status(body.statusCode).json(body);
  }

  private toErrorBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const payload = exception.getResponse();
      if (isErrorBody(payload)) return payload;
      const message = typeof payload === 'string' ? payload : exception.message;
      return { statusCode, code: HttpStatus[statusCode] ?? 'HTTP_ERROR', message };
    }
    return { statusCode: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' };
  }
}
