/**
 * Umbral de "stock bajo", en días restantes. Valor de producto declarado,
 * no medido: debe ser >= el lead time realista de un refill (solicitud ->
 * ofertas -> aceptación -> despacho), porque la alerta solo sirve si queda
 * stock para cubrir la espera. `RefillRequest.urgencia` declara
 * `en_2_3_dias` como su tramo más lento; 7 días da ~2x de margen sobre ese
 * tramo. Subirlo o bajarlo es un cambio de una línea, cubierto por tests.
 *
 * Constante de dominio, no columna ni variable de entorno (design.md D-B):
 * es una regla de producto, no un parámetro operativo, y `env.schema.ts`
 * contiene hoy exclusivamente infraestructura. La ruta a "umbral por
 * usuario" y a "umbral por `kind`" queda abierta y es puramente aditiva —
 * ninguna de las dos necesita esta constante desaparecer, solo dejar de ser
 * la única fuente.
 */
export const UMBRAL_STOCK_BAJO_DIAS = 7;

/**
 * usuario-mobile-consumo design.md D-2: fixed IANA zone for adherence day
 * bucketing (`ventanaAdherencia`, `contarTomasPorDia`'s `at time zone`).
 * Correct for a Chile-only launch — already visible in the data model
 * (`refill_requests.comuna`) and in `usuario-mobile/SPEC.md` (Webpay). A
 * user-level timezone is a purely additive follow-up: every consumer of
 * this constant already takes `zonaHoraria` as a parameter rather than
 * importing this constant directly into its own logic, so replacing the
 * single global with a per-user lookup needs no signature change anywhere.
 * Day bucketing without a fixed zone would silently shift every boundary
 * dose into the wrong day.
 */
export const ZONA_HORARIA_ADHERENCIA = 'America/Santiago';
