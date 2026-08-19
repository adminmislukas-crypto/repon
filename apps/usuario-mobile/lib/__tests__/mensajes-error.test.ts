import { ApiError, NetworkError, SesionApiError } from '@repon/auth';
import { mensajeDeError } from '../mensajes-error';

// usuario-mobile-consumo design.md D-10: the 5 ConsumoExceptionFilter codes
// + the network case, each mapping to a distinct Spanish string, plus an
// unknown-code fallback and SesionApiError acceptance (login.tsx's future
// adoption path).

describe('mensajeDeError', () => {
  const codigosConocidos = [
    'CONSUMPTION_NOT_FOUND',
    'PET_NOT_FOUND',
    'MASCOTA_INVALIDA',
    'CONSUMO_INVALIDO',
    'DOSIS_INVALIDA',
    'RED_NO_DISPONIBLE',
  ];

  it('maps each of the 6 known codes to a distinct, non-empty message', () => {
    const mensajes = new Set<string>();
    for (const code of codigosConocidos) {
      const mensaje = mensajeDeError(new ApiError(400, code, 'x'));
      expect(mensaje.length).toBeGreaterThan(0);
      mensajes.add(mensaje);
    }
    expect(mensajes.size).toBe(codigosConocidos.length);
  });

  it('maps an unknown ApiError code to POR_DEFECTO', () => {
    expect(mensajeDeError(new ApiError(400, 'UNKNOWN_ERROR', 'x'))).toBe('Algo salió mal. Intenta de nuevo.');
  });

  it('maps NetworkError to the RED_NO_DISPONIBLE message', () => {
    expect(mensajeDeError(new NetworkError())).toBe('Sin conexión. Revisa tu red e intenta de nuevo.');
  });

  it('accepts a SesionApiError too, mapping by the same .code lookup', () => {
    expect(mensajeDeError(new SesionApiError(404, 'PET_NOT_FOUND', 'x'))).toBe(
      'Esa mascota ya no existe. Vuelve a seleccionarla.',
    );
  });

  it('falls back to POR_DEFECTO for a SesionApiError with an unrecognized code', () => {
    expect(mensajeDeError(new SesionApiError(400, 'ROL_NO_PERMITIDO', 'x'))).toBe(
      'Algo salió mal. Intenta de nuevo.',
    );
  });

  it('falls back to POR_DEFECTO for a plain Error or any non-wire-error value', () => {
    expect(mensajeDeError(new Error('boom'))).toBe('Algo salió mal. Intenta de nuevo.');
    expect(mensajeDeError('a string')).toBe('Algo salió mal. Intenta de nuevo.');
    expect(mensajeDeError(null)).toBe('Algo salió mal. Intenta de nuevo.');
  });
});
