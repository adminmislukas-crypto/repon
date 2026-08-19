import { ApiError, NetworkError, SesionApiError } from '@repon/auth';

/**
 * usuario-mobile-consumo design.md D-10: error-code → Spanish message
 * mapping, mirroring `app/login.tsx`'s `ERROR_MESSAGES` record precedent.
 * The split is deliberate: `@repon/auth` owns the wire envelope (protocol,
 * `ApiError`/`NetworkError`), this app owns the words (product copy, tone,
 * locale). These are exactly the 5 codes `ConsumoExceptionFilter` emits,
 * plus the network case — a `ValidationPipe` 400 carries no `code` (the
 * forms client-validate the same invariants first, so it's unreachable in
 * practice), and falls to `POR_DEFECTO` like any other unrecognized code.
 */
const MENSAJES: Record<string, string> = {
  CONSUMPTION_NOT_FOUND: 'Ese consumo ya no existe. Actualiza la lista.',
  PET_NOT_FOUND: 'Esa mascota ya no existe. Vuelve a seleccionarla.',
  MASCOTA_INVALIDA: 'Revisa el nombre y la especie de la mascota.',
  CONSUMO_INVALIDO: 'Revisa los datos del consumo.',
  DOSIS_INVALIDA: 'No se puede registrar una dosis en el futuro.',
  RED_NO_DISPONIBLE: 'Sin conexión. Revisa tu red e intenta de nuevo.',
};

const POR_DEFECTO = 'Algo salió mal. Intenta de nuevo.';

/**
 * Accepts `ApiError | NetworkError | SesionApiError` — the three classes
 * that carry a wire `.code` in this codebase. `SesionApiError` is included
 * so `login.tsx` can adopt this helper later (merging the two records is a
 * named follow-up, not this change — no `@repon/auth`/login behaviour
 * change is in scope here).
 */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError || error instanceof SesionApiError) {
    return MENSAJES[error.code] ?? POR_DEFECTO;
  }
  return POR_DEFECTO;
}
