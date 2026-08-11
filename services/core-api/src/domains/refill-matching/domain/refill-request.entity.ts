import { randomUUID } from 'node:crypto';
import type {
  NuevoRefillItem,
  RefillItem,
  RefillItemBorrador,
  RefillRequest,
  RefillRequestActiva,
  RefillRequestBorrador,
  Urgencia,
} from '@repon/types';
import {
  RefillItemDesconocidoError,
  SolicitudIncompletaError,
  SolicitudInvalidaError,
  TransicionInvalidaError,
} from './refill.errors';

export type { RefillRequest };

// ============================================================
// crearSolicitudActiva (tasks.md 2.1/2.2, design.md Diagrama 1 pasos 4-5)
// ============================================================

/**
 * Valida el input CRUDO del camino manual (D12). `SolicitudInvalidaError`
 * cubre exactamente lo que su propio doc-comment en `refill.errors.ts`
 * declara: cero ítems, `nombre`/`categoria`/`direccion`/`comuna` vacíos, o
 * `precioReferencia` negativo — no solo el subconjunto mínimo
 * (`items`/`direccion`/`comuna`) que tasks.md 2.1 nombra explícitamente.
 * Se agrega la validación por-ítem acá, en la entidad, por el mismo motivo
 * que `provider-catalog-item.entity.ts`'s `assertProductoValido` existe: el
 * DTO de `adapters/http/` (Phase 4b) valida lo mismo, pero el dominio no
 * confía en ningún caller futuro para sostener su propio invariante.
 */
function assertSolicitudValida(
  items: readonly NuevoRefillItem[],
  direccion: string,
  comuna: string,
): void {
  if (items.length === 0) {
    throw new SolicitudInvalidaError('items no puede estar vacío.');
  }
  if (direccion.trim() === '') {
    throw new SolicitudInvalidaError('direccion no puede estar vacía.');
  }
  if (comuna.trim() === '') {
    throw new SolicitudInvalidaError('comuna no puede estar vacía.');
  }
  items.forEach(assertItemValido);
}

function assertItemValido(item: NuevoRefillItem): void {
  if (item.nombre.trim() === '') {
    throw new SolicitudInvalidaError('nombre del ítem no puede estar vacío.');
  }
  if (item.categoria.trim() === '') {
    throw new SolicitudInvalidaError('categoria del ítem no puede estar vacía.');
  }
  if (!Number.isFinite(item.precioReferencia) || item.precioReferencia < 0) {
    throw new SolicitudInvalidaError(
      `precioReferencia (${item.precioReferencia}) debe ser un número finito >= 0.`,
    );
  }
}

/**
 * Factory del camino manual (design.md Diagrama 1, pasos 4-5; tasks.md
 * 2.1/2.2). A diferencia de `pet.entity.ts`/`user-consumption.entity.ts`
 * (donde el caller genera `id` vía `randomUUID()` y lo pasa como input),
 * ESTA factory genera los ids ella misma: la firma no recibe ninguno
 * (`NuevoRefillItem` no tiene `id`) — no hay otro lugar de donde puedan
 * salir. Sigue siendo el mismo precedente de fondo ("nunca un default de la
 * DB"), solo que el paso de `randomUUID()` cae dentro de la entidad en vez
 * de en el caso de uso que la llama (Phase 4a, `CrearSolicitudUseCase`).
 * `estado: 'abierta'` por construcción — el tipo de retorno es
 * `RefillRequestActiva` (D-B), nunca requiere un cast.
 */
export function crearSolicitudActiva(
  userId: string,
  items: readonly NuevoRefillItem[],
  direccion: string,
  comuna: string,
  urgencia: Urgencia,
): RefillRequestActiva {
  assertSolicitudValida(items, direccion, comuna);

  return {
    id: randomUUID(),
    userId,
    urgencia,
    estado: 'abierta',
    direccion,
    comuna,
    items: items.map((item): RefillItem => ({
      id: randomUUID(),
      nombre: item.nombre,
      categoria: item.categoria,
      precioReferencia: item.precioReferencia,
      catalogProductId: item.catalogProductId,
    })),
  };
}

// ============================================================
// crearBorrador (tasks.md 2.3/2.4, design.md Diagrama 3 paso 3d / D-G.1)
// ============================================================

/**
 * Entrada de `crearBorrador` (design.md Diagrama 3, paso 3d): a diferencia
 * de `crearSolicitudActiva`, el caller (Phase 6a's `CrearBorradorRefillUseCase`,
 * dentro de `runInTransaction`) YA generó `id`/`consumptionId`/los ids de
 * cada ítem antes de llamar acá — el listener no tiene de dónde sacar
 * `direccion`/`comuna`/`categoria`/`precioReferencia` (D3), así que esos
 * campos NI SIQUIERA aparecen en esta firma.
 */
export interface CrearBorradorInput {
  id: string;
  userId: string;
  consumptionId?: string;
  urgencia: Urgencia;
  items: readonly RefillItemBorrador[];
}

/**
 * Factory del camino automático (tasks.md 2.3/2.4). Sin invariante de
 * completitud — por diseño: un borrador es, por definición, una solicitud
 * que todavía no la cumple (D3/D4). `estado: 'borrador'` por construcción.
 */
export function crearBorrador(input: CrearBorradorInput): RefillRequestBorrador {
  return {
    id: input.id,
    userId: input.userId,
    urgencia: input.urgencia,
    consumptionId: input.consumptionId,
    estado: 'borrador',
    items: [...input.items],
  };
}

// ============================================================
// completar (tasks.md 2.5/2.6, design.md D3/D4/D-E)
// ============================================================

/**
 * Entrada por ítem de `completar`. Espejo exacto de design.md D-E's
 * `CompletarRefillItemInput` — declarado ACÁ (no en `@repon/types`, D-B) y
 * exportado para que Phase 6b's `CompletarBorradorUseCase` lo importe en
 * vez de redeclararlo: `completar()` es quien primero necesita esta forma,
 * un archivo antes de donde design.md la ubicó originalmente
 * (`ports-in/completar-borrador.use-case.ts`). `categoria`/`precioReferencia`
 * son REQUERIDOS acá (a diferencia de `RefillItemBorrador`): completar un
 * ítem sin ellos no tiene sentido — "falta" se expresa omitiendo la entrada
 * completa, nunca con un campo vacío que el tipo permitiría colar.
 */
export interface CompletarRefillItemInput {
  /** DEBE referenciar un `refill_items.id` (`RefillItemBorrador.id`) del borrador. */
  refillItemId: string;
  categoria: string;
  precioReferencia: number;
  catalogProductId?: string;
}

export interface CompletarInput {
  direccion: string;
  comuna: string;
  /** Opcional: si se omite, se conserva `borrador.urgencia` (D-G.1: el
   *  listener persiste `'lo_antes_posible'` de arranque; el usuario la
   *  confirma o la cambia acá). */
  urgencia?: Urgencia;
  items: readonly CompletarRefillItemInput[];
}

function assertCompletitud(condicion: boolean, mensaje: string): void {
  if (!condicion) {
    throw new SolicitudIncompletaError(mensaje);
  }
}

function esTextoNoVacio(valor: string | undefined): valor is string {
  return typeof valor === 'string' && valor.trim() !== '';
}

/**
 * Transición `'borrador' -> 'abierta'` (tasks.md 2.5/2.6, design.md D3/D4).
 * Función PURA: nunca muta `borrador` ni `input` — cada campo se LEE, nunca
 * se escribe, así que un rechazo a mitad de camino no deja ningún estado a
 * medio construir (el criterio "no-mutating on rejection" cae solo de no
 * asignar nada hasta el `return` final).
 *
 * Los ítems se actualizan EN SU LUGAR: el array de salida tiene el mismo
 * largo y los mismos ids que `borrador.items`, en el mismo orden — nunca se
 * reemplaza (design.md D-E: "ningún DELETE físico introducido"). Cada ítem
 * del borrador que no aparece en `input.items` conserva sus propios
 * `categoria`/`precioReferencia` si ya los tenía (un borrador puede legalmente
 * llevarlos, D-B); si no los tenía, la validación de completitud de abajo lo
 * atrapa.
 *
 * El tipo de retorno es `RefillRequestActiva` sin cast: el objeto que se
 * construye trae `estado: 'abierta'` y `items: RefillItem[]` literales, así
 * que TypeScript lo acepta directamente contra la unión discriminada (D-B)
 * — la garantía de tipos, no solo el chequeo en runtime.
 */
export function completar(
  borrador: RefillRequestBorrador,
  input: CompletarInput,
): RefillRequestActiva {
  assertCompletitud(
    esTextoNoVacio(input.direccion),
    'direccion es obligatoria para completar la solicitud.',
  );
  assertCompletitud(
    esTextoNoVacio(input.comuna),
    'comuna es obligatoria para completar la solicitud.',
  );

  const idsDelBorrador = new Set(borrador.items.map((item) => item.id));
  for (const entrada of input.items) {
    if (!idsDelBorrador.has(entrada.refillItemId)) {
      throw new RefillItemDesconocidoError(entrada.refillItemId);
    }
  }

  const entradasPorId = new Map(input.items.map((entrada) => [entrada.refillItemId, entrada]));

  const items: RefillItem[] = borrador.items.map((borradorItem) => {
    const entrada = entradasPorId.get(borradorItem.id);
    const categoria = entrada?.categoria ?? borradorItem.categoria;
    const precioReferencia = entrada?.precioReferencia ?? borradorItem.precioReferencia;
    const catalogProductId = entrada?.catalogProductId ?? borradorItem.catalogProductId;

    assertCompletitud(
      esTextoNoVacio(categoria),
      `El ítem ${borradorItem.id} no tiene categoria — no se puede completar la solicitud.`,
    );
    assertCompletitud(
      typeof precioReferencia === 'number' && Number.isFinite(precioReferencia),
      `El ítem ${borradorItem.id} no tiene precioReferencia — no se puede completar la solicitud.`,
    );

    return {
      id: borradorItem.id,
      nombre: borradorItem.nombre,
      categoria: categoria as string,
      precioReferencia: precioReferencia as number,
      catalogProductId,
    };
  });

  return {
    id: borrador.id,
    userId: borrador.userId,
    urgencia: input.urgencia ?? borrador.urgencia,
    consumptionId: borrador.consumptionId,
    estado: 'abierta',
    items,
    direccion: input.direccion,
    comuna: input.comuna,
  };
}

// ============================================================
// Máquina de estados: marcarOfertada / marcarConfirmada
// (tasks.md 2.7/2.8, design.md D6/D-G.2)
// ============================================================

/**
 * `'abierta' -> 'ofertada'`. Wrapper trivial que `KyselyRefillRepository`'s
 * `actualizarEstado` (Phase 7) va a persistir — sin ruta HTTP, sin caller en
 * este cambio (D6). Función pura: devuelve un objeto NUEVO, nunca muta
 * `activa`.
 */
export function marcarOfertada(activa: RefillRequestActiva): RefillRequestActiva {
  if (activa.estado !== 'abierta') {
    throw new TransicionInvalidaError(
      `No se puede marcar como ofertada una solicitud en estado '${activa.estado}' (se esperaba 'abierta').`,
    );
  }

  return { ...activa, estado: 'ofertada' };
}

/** `'ofertada' -> 'confirmada'`. Misma forma que `marcarOfertada`. */
export function marcarConfirmada(ofertada: RefillRequestActiva): RefillRequestActiva {
  if (ofertada.estado !== 'ofertada') {
    throw new TransicionInvalidaError(
      `No se puede marcar como confirmada una solicitud en estado '${ofertada.estado}' (se esperaba 'ofertada').`,
    );
  }

  return { ...ofertada, estado: 'confirmada' };
}
