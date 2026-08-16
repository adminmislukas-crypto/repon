import { Injectable } from '@nestjs/common';
import type { PaymentGatewayPort } from './payment-gateway.port';
import { PasarelaNoConfiguradaError } from './payments.errors';

/**
 * `PaymentGatewayPort`'s binding hasta que la fase 6 elija una pasarela
 * real (design.md D-C.2). **No es andamio, es la rama permanente**: en la
 * fase 6, `PaymentsModule` pasa a `useFactory` — con credenciales bindea
 * el adaptador real, sin ellas sigue bindeando ESTE. Así, "las credenciales
 * no son env vars requeridas incondicionalmente — un entorno sin ellas
 * sigue booteando" se cumple sin código nuevo, y el modo de falla es
 * explícito (503 nombrando la variable faltante) en vez de un
 * `undefined is not a function` en runtime.
 */
@Injectable()
export class PasarelaNoConfiguradaAdapter implements PaymentGatewayPort {
  // Sin parámetros declarados a propósito: TypeScript permite que una
  // implementación tenga MENOS parámetros que la interfaz que satisface
  // (misma convención que `ofertas`' PR8a ya estableció para closures de
  // repositorio falso) — cada método rechaza sin necesitar leer sus
  // argumentos, así que declararlos solo invitaría a un lint de
  // "parámetro no usado".
  async crearTransaccion(): Promise<{ checkoutUrl: string; externalTransactionId: string }> {
    throw new PasarelaNoConfiguradaError('credenciales de la pasarela de pago');
  }

  async verificarPago(): Promise<never> {
    throw new PasarelaNoConfiguradaError('credenciales de la pasarela de pago');
  }
}
