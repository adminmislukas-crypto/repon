import { randomUUID } from 'node:crypto';
import type {
  DatosEntrega,
  NuevoOfferItemProactiva,
  NuevoOfferItemReactiva,
  Offer,
  OfferItemProactiva,
  OfferItemReactiva,
} from '@repon/types';
import { OfertaInvalidaError, TransicionInvalidaError } from './oferta.errors';

export type { Offer };

// ============================================================
// Validación compartida por ambas factories (tasks.md 2.1/2.3,
// oferta.errors.ts's OfertaInvalidaError doc-comment: "0 items, isAlt:
// true sin altNote, un precio negativo"). Misma disciplina que
// refill-request.entity.ts's assertSolicitudValida/assertItemValido: el
// dominio no confía en el tipo TS de ningún caller — un OfferItemAlt mal
// formado (p.ej. un DTO HTTP antes de que corra class-validator, Phase
// 4b) puede llegar acá con altNote ausente o vacío pese a que el union
// discriminado lo exige en tiempo de compilación.
// ============================================================

interface ItemValidable {
  precio: number;
  isAlt: boolean;
  altNote?: string;
}

function assertItemsValidos(items: readonly ItemValidable[]): void {
  if (items.length === 0) {
    throw new OfertaInvalidaError('La oferta debe tener al menos un ítem.');
  }
  items.forEach(assertItemValido);
}

function assertItemValido(item: ItemValidable): void {
  if (item.isAlt && (!item.altNote || item.altNote.trim() === '')) {
    throw new OfertaInvalidaError('Un ítem con isAlt: true requiere altNote.');
  }
  if (!Number.isFinite(item.precio) || item.precio < 0) {
    throw new OfertaInvalidaError(`precio (${item.precio}) debe ser un número finito >= 0.`);
  }
}

// El dominio no confía en el tipo TS de ningún caller (mismo criterio que
// assertItemValido, arriba): `DatosEntrega.costoDespacho` es `number` a
// nivel de tipo pero nada impide que un caller pase un valor negativo o
// no-finito antes de que exista una capa de DTO/class-validator (Phase
// 4b/5b). `total()` lo suma directo al total persistido — sin este
// chequeo, una oferta con `total` negativo pasaría por esta factory sin
// que nada lo detecte (hallazgo de code-review sobre PR5a).
function assertEntregaValida(entrega: DatosEntrega): void {
  if (!Number.isFinite(entrega.costoDespacho) || entrega.costoDespacho < 0) {
    throw new OfertaInvalidaError(
      `costoDespacho (${entrega.costoDespacho}) debe ser un número finito >= 0.`,
    );
  }
}

// ============================================================
// crearOfertaReactiva (tasks.md 2.1/2.2)
// ============================================================

/**
 * Factory del camino reactivo (responde a una `RefillRequest`).
 * `status: 'pendiente'` y `kind: 'reactiva'` por construcción — el tipo de
 * retorno es la rama `reactiva` de la unión `Offer`, nunca requiere un
 * cast. `id` vía `randomUUID()` (nunca un default de la DB, mismo
 * precedente que `refill-request.entity.ts`'s `crearSolicitudActiva`).
 *
 * `items` gana `id`/`nombre` (`backend-core-api-pedidos-pagos` design.md
 * D-B.4): `id` lo genera esta factory (`randomUUID()`, nunca el default de
 * la columna — `pedidos-pagos` lo necesita como `order_items.offer_item_id`,
 * `NOT NULL` con FK). `nombre` llega YA RESUELTO por el caso de uso
 * (`EnviarOfertaUseCase`, que tiene `refillItemsById` en la mano) — el
 * ensanchamiento local `& { nombre: string }` es del PARÁMETRO de esta
 * factory, nunca de `NuevoOfferItemReactiva` en `@repon/types`, que sigue
 * sin declarar ni `id` ni `nombre`: el cliente nunca los envía.
 */
export function crearOfertaReactiva(
  companyId: string,
  refillRequestId: string,
  items: readonly (NuevoOfferItemReactiva & { nombre: string })[],
  entrega: DatosEntrega,
  userId: string,
  mensaje?: string,
): Offer {
  assertItemsValidos(items);
  assertEntregaValida(entrega);

  const itemsOferta: OfferItemReactiva[] = items.map((item) => ({
    ...item,
    id: randomUUID(),
  }));

  return {
    id: randomUUID(),
    userId,
    companyId,
    status: 'pendiente',
    tiempoEntregaHoras: entrega.tiempoEntregaHoras,
    costoDespacho: entrega.costoDespacho,
    total: total(items, entrega.costoDespacho),
    mensaje,
    kind: 'reactiva',
    refillRequestId,
    items: itemsOferta,
  };
}

// ============================================================
// crearOfertaProactiva (tasks.md 2.3/2.4)
// ============================================================

/**
 * Factory del camino proactivo (sin `RefillRequest` que la origine).
 * `status: 'pendiente'` y `kind: 'proactiva'` por construcción, la rama
 * `proactiva` de `Offer` tiene `refillRequestId?: never` — esta factory
 * simplemente no recibe (ni asigna) ese parámetro, nunca lo fuerza a
 * `undefined` explícito por accidente. `providerCatalogItemId` requerido
 * por ítem ya lo exige `NuevoOfferItemProactiva` en tiempo de compilación
 * (`refillItemId?: never`) — nada que validar en runtime además de eso.
 *
 * `items` gana `id`/`nombre`, mismo criterio que `crearOfertaReactiva`:
 * `id` vía `randomUUID()` acá; `nombre` ya resuelto por el caso de uso
 * (`EnviarOfertaProactivaUseCase`, desde `ProviderCatalogItem.nombre`).
 */
export function crearOfertaProactiva(
  companyId: string,
  userId: string,
  items: readonly (NuevoOfferItemProactiva & { nombre: string })[],
  entrega: DatosEntrega,
  mensaje?: string,
): Offer {
  assertItemsValidos(items);
  assertEntregaValida(entrega);

  const itemsOferta: OfferItemProactiva[] = items.map((item) => ({
    ...item,
    id: randomUUID(),
  }));

  return {
    id: randomUUID(),
    userId,
    companyId,
    status: 'pendiente',
    tiempoEntregaHoras: entrega.tiempoEntregaHoras,
    costoDespacho: entrega.costoDespacho,
    total: total(items, entrega.costoDespacho),
    mensaje,
    kind: 'proactiva',
    items: itemsOferta,
  };
}

// ============================================================
// total (tasks.md 2.5/2.6, design.md D-G.2 paso 9: "total = suma(precios)
// + costoDespacho <- dominio puro"). Función pura, sin I/O.
// ============================================================

interface ItemConPrecio {
  precio: number;
}

/**
 * `Σ(item.precio) + costoDespacho`. Calculada FUERA de la transacción por
 * el caso de uso (Phase 5a, design.md D13 paso 9) — acá solo vive la
 * fórmula, nunca el orden en que se llama.
 */
export function total(items: readonly ItemConPrecio[], costoDespacho: number): number {
  return items.reduce((suma, item) => suma + item.precio, 0) + costoDespacho;
}

// ============================================================
// precioPorUnidad (tasks.md 2.7/2.8, design.md D-G.2, ofertas/SPEC.md:
// "el cálculo del precio por unidad/kilo para comparar contra la
// referencia también es una función de dominio pura").
// ============================================================

interface ItemConPrecioAlt {
  precio: number;
  altSize?: number;
  altQty?: number;
}

/**
 * Fórmula verificada contra el mockup existente del producto
 * (`apps/proveedor-mobile/mockups/proveedor.html`'s `updateAltNote`):
 * `unitAlt = totalAlt / (altSize * altQty)`, donde `totalAlt` es el total
 * YA MULTIPLICADO de la línea — exactamente lo que `item.precio` es en
 * este dominio (`total()` arriba suma `item.precio` directo, sin un paso
 * separado de precio-unitario × cantidad en ningún otro lugar).
 *
 * `altSize`/`altQty` ausentes ⇒ 1 (nada que normalizar: el propio
 * `precio` ya es su precio por unidad). Un `altSize`/`altQty` <= 0 es
 * defensivo (`db-schema-ofertas` no debería producirlo nunca) pero esta
 * es una función pura que jamás debe dividir por cero — cae al mismo
 * `precio` sin normalizar en vez de devolver `Infinity`/`NaN`.
 *
 * Riesgo residual nombrado en design.md D-G.2 (y en su lista de riesgos
 * residuales): esta función solo CALCULA un valor comparable, no impone
 * ningún techo. El techo de `precio_maximo` aplica exclusivamente a
 * ítems no-`isAlt` y lo enforce `EnviarOfertaUseCase` (Phase 5a), nunca
 * acá. Un ítem `isAlt` no tiene techo de precio server-side hoy —
 * cerrarlo exige normalizar presentaciones, su propio cambio de producto.
 */
export function precioPorUnidad(item: ItemConPrecioAlt): number {
  const altSize = item.altSize ?? 1;
  const altQty = item.altQty ?? 1;
  if (altSize <= 0 || altQty <= 0) {
    return item.precio;
  }
  return item.precio / (altSize * altQty);
}

// ============================================================
// Máquina de estados de OfferStatus (tasks.md 2.9/2.10, design.md D-G.3)
// ============================================================

/**
 * Única transición admitida: `'pendiente' -> 'aceptada'`. Cualquier otro
 * origen — incluida la MISMA oferta ya `'aceptada'` — lanza
 * `TransicionInvalidaError` (409, D-G.3): aceptar dos veces la misma
 * oferta no viola el índice único parcial `offers_refill_request_id_
 * aceptada_uidx` (es la misma fila), así que sin esta regla explícita el
 * segundo llamado sería un no-op silencioso — exactamente lo que
 * design.md rechaza.
 *
 * Función PURA: nunca muta `offer`, devuelve un objeto NUEVO — mismo
 * criterio que `refill-request.entity.ts`'s `marcarOfertada`/
 * `marcarConfirmada`. `AceptarOfertaUseCase` (Phase 7a, design.md D-D) es
 * quien la llama, DESPUÉS de `offerRepository.findById(offerId, tx)` y
 * ANTES de `offerRepository.marcarAceptada(offerId, tx)`: esta función
 * valida la transición, el repositorio ejecuta el UPDATE angosto de 1
 * columna — dos responsabilidades separadas a propósito.
 */
export function aceptar(offer: Offer): Offer {
  if (offer.status !== 'pendiente') {
    throw new TransicionInvalidaError(
      `No se puede aceptar una oferta en estado '${offer.status}' (se esperaba 'pendiente').`,
    );
  }

  return { ...offer, status: 'aceptada' };
}
