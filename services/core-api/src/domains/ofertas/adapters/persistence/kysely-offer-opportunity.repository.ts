import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { RefillItem, SolicitudElegible, SolicitudElegibleItem } from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { DB, RefillUrgenciaRow } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import type {
  OfferOpportunityRepository,
  OportunidadElegible,
  OportunidadSnapshot,
} from '../../ports-out/offer-opportunity-repository.port';

/**
 * `KyselyOfferOpportunityRepository` — el writer de D5 (design.md D-A,
 * tasks.md Phase 3b). "El PR con la mecánica más delicada del cambio"
 * (design.md, "Secuencia de implementación"): `reemplazar()` es la ÚNICA
 * escritura multi-fila con `ON CONFLICT ... DO UPDATE` de todo el repo — cada
 * `save()` anterior (`KyselyCompanyRepository`, `KyselyPetRepository`,
 * `KyselyCatalogVisibilityProjection`) upsertea UNA fila a la vez, así que
 * pasar un objeto JS literal a `.doUpdateSet({...})` es correcto ahí (la
 * única fila insertada ES la única fila actualizada). Acá NO: el paso 5
 * (items) inserta N filas con conflictos independientes, y un objeto
 * literal en `.doUpdateSet({...})` fijaría la MISMA fila para las N
 * filas en conflicto — silenciosamente corrompiendo todos los items
 * menos el último. Por eso el paso 5 usa la forma callback de Kysely
 * (`(eb) => ({ col: eb.ref('excluded.col') })`), y los pasos 1/3 (de una
 * sola fila, o con un `SET` de valor CONSTANTE) no la necesitan.
 *
 * Las 3 propiedades de design.md D-A.2, cada una con su comentario en el
 * lugar exacto: (1) orden retire→upsert NO conmutativo — invertirlo apaga
 * las filas recién escritas; (2) las 5 sentencias corren en la MISMA `tx`
 * (D-G.5: `tx` requerido, nunca opcional, acá) — bajo `read committed`
 * nadie observa el estado intermedio; (3) la idempotencia cae del upsert,
 * no de un chequeo explícito.
 */
@Injectable()
export class KyselyOfferOpportunityRepository implements OfferOpportunityRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  /**
   * D5/D-A.2 — 5 sentencias como máximo, retire-blanket-then-upsert, todas
   * dentro de la MISMA transacción (`tx` REQUERIDO, D-G.5 — llamarlo sin
   * `tx` no compila). `cerrada_at` NUNCA aparece en el `SET` de la cabecera
   * (D-A.3): cerrar es monótono, un `MatchEncontrado` posterior refresca la
   * cabecera pero jamás reabre la oportunidad.
   */
  async reemplazar(snapshot: OportunidadSnapshot, tx: TransactionContext): Promise<void> {
    const executor = toKyselyTransaction(tx);
    const matchedAt = new Date().toISOString();

    // 1. Upsert cabecera. Fila única -> un objeto JS literal en doUpdateSet
    // es correcto (el valor insertado y el valor "excluded" son el mismo).
    // `cerrada_at` NUNCA en este SET.
    await executor
      .insertInto('offer_opportunities')
      .values({
        refill_request_id: snapshot.refillRequestId,
        user_id: snapshot.userId,
        comuna: snapshot.comuna,
        urgencia: snapshot.urgencia,
        matched_at: matchedAt,
      })
      .onConflict((oc) =>
        oc.column('refill_request_id').doUpdateSet({
          user_id: snapshot.userId,
          comuna: snapshot.comuna,
          urgencia: snapshot.urgencia,
          matched_at: matchedAt,
          // cerrada_at OMITIDO A PROPOSITO — D-A.3.
        }),
      )
      .execute();

    // 2. Retire en bloque de empresas. ORDEN NO CONMUTATIVO (design.md
    // D-A.2): SIEMPRE antes del paso 3 — invertirlo apagaría las filas que
    // el upsert acaba de (re)instalar y la solicitud quedaría sin
    // elegibles. "El bug más fácil de introducir en este archivo."
    await executor
      .updateTable('offer_opportunity_companies')
      .set({ vigente: false })
      .where('refill_request_id', '=', snapshot.refillRequestId)
      .where('vigente', '=', true)
      .execute();

    // 3. Upsert de empresas vigentes — 1 sentencia multi-fila, nunca N
    // round-trips. Se OMITE si companyIds es []: el retire en bloque del
    // paso 2 ya deja la solicitud sin elegibles, no hay nada que upsertear.
    // `vigente = true` es CONSTANTE para toda fila en conflicto (no
    // depende de qué company_id chocó), así que un literal estático es
    // seguro incluso en este upsert multi-fila.
    if (snapshot.companyIds.length > 0) {
      await executor
        .insertInto('offer_opportunity_companies')
        .values(
          snapshot.companyIds.map((companyId) => ({
            refill_request_id: snapshot.refillRequestId,
            company_id: companyId,
          })),
        )
        .onConflict((oc) =>
          oc.columns(['refill_request_id', 'company_id']).doUpdateSet({ vigente: true }),
        )
        .execute();
    }

    // 4. Retire en bloque de items. Mismo orden no conmutativo que el
    // paso 2, SIEMPRE antes del paso 5.
    await executor
      .updateTable('offer_opportunity_items')
      .set({ vigente: false })
      .where('refill_request_id', '=', snapshot.refillRequestId)
      .where('vigente', '=', true)
      .execute();

    // 5. Upsert de items vigentes — 1 sentencia multi-fila. A diferencia del
    // paso 3, acá SÍ hay columnas que varían fila a fila (nombre/categoria/
    // precio_referencia/catalog_product_id), así que el SET usa la forma
    // callback de Kysely para referenciar la fila `excluded` DE CADA fila en
    // conflicto — un objeto literal estático fijaría el mismo valor para
    // TODOS los items del batch, corrompiendo silenciosamente todos menos
    // el último (ver el comentario de clase). `items` nunca llega vacío por
    // contrato del evento (`RefillRequestActiva` garantiza >= 1 item), a
    // diferencia de `companyIds`, así que este paso no se condiciona.
    await executor
      .insertInto('offer_opportunity_items')
      .values(
        snapshot.items.map((item) => ({
          refill_item_id: item.refillItemId,
          refill_request_id: snapshot.refillRequestId,
          nombre: item.nombre,
          categoria: item.categoria,
          precio_referencia: item.precioReferencia.toFixed(2),
          catalog_product_id: item.catalogProductId,
        })),
      )
      .onConflict((oc) =>
        oc.column('refill_item_id').doUpdateSet((eb) => ({
          nombre: eb.ref('excluded.nombre'),
          categoria: eb.ref('excluded.categoria'),
          precio_referencia: eb.ref('excluded.precio_referencia'),
          catalog_product_id: eb.ref('excluded.catalog_product_id'),
          vigente: true,
        })),
      )
      .execute();
  }

  /**
   * D11/D8 — usado por `enviarOferta` ANTES de abrir cualquier transacción
   * (D13/R3), por eso nunca toma `tx`. `null` si la solicitud no existe O si
   * `companyId` no es elegible ahora mismo (`vigente = true`) — el caller no
   * distingue los dos casos. NO filtra por `cerrada_at`: el caller decide el
   * 409 (design.md Diagrama 2, paso 5).
   *
   * 2 queries, deliberado: la elegibilidad (join contra
   * `offer_opportunity_companies`) y la lectura de items corren por
   * separado para que "elegible pero con 0 items vigentes" (un caso que no
   * debería ocurrir, pero que un solo INNER JOIN colapsaría al mismo `null`
   * que "no elegible") nunca se confunda con "no elegible".
   */
  async findElegible(
    refillRequestId: string,
    companyId: string,
  ): Promise<OportunidadElegible | null> {
    const header = await this.db
      .selectFrom('offer_opportunity_companies as c')
      .innerJoin('offer_opportunities as o', 'o.refill_request_id', 'c.refill_request_id')
      .select(['o.refill_request_id', 'o.user_id', 'o.comuna', 'o.urgencia', 'o.cerrada_at'])
      .where('c.refill_request_id', '=', refillRequestId)
      .where('c.company_id', '=', companyId)
      .where('c.vigente', '=', true)
      .executeTakeFirst();

    if (!header) {
      return null;
    }

    const itemRows = await this.db
      .selectFrom('offer_opportunity_items')
      .select(['refill_item_id', 'nombre', 'categoria', 'precio_referencia', 'catalog_product_id'])
      .where('refill_request_id', '=', refillRequestId)
      .where('vigente', '=', true)
      .execute();

    return {
      refillRequestId: header.refill_request_id,
      userId: header.user_id,
      comuna: header.comuna,
      urgencia: header.urgencia,
      cerradaAt: header.cerrada_at,
      items: itemRows.map(toRefillItem),
    };
  }

  /**
   * D-E — la lista del proveedor (`GET /ofertas/oportunidades`), design.md
   * Diagrama 3 al pie de la letra: 1 sola query con 2 joins, items inline,
   * nunca N+1. Filtra `c.vigente` (D5: el proveedor expulsado desaparece),
   * `o.cerrada_at is null` (D12: la oportunidad cerrada desaparece PARA
   * TODOS) e `i.vigente`. Nunca lleva `userId`: el proveedor no tiene por
   * qué conocer el `profileId` del destinatario antes de ofertar.
   */
  async listarPorCompany(companyId: string): Promise<SolicitudElegible[]> {
    const rows = await this.db
      .selectFrom('offer_opportunity_companies as c')
      .innerJoin('offer_opportunities as o', 'o.refill_request_id', 'c.refill_request_id')
      .innerJoin('offer_opportunity_items as i', 'i.refill_request_id', 'o.refill_request_id')
      .select([
        'o.refill_request_id',
        'o.comuna',
        'o.urgencia',
        'o.matched_at',
        'i.refill_item_id',
        'i.nombre',
        'i.categoria',
        'i.precio_referencia',
        'i.catalog_product_id',
      ])
      .where('c.company_id', '=', companyId)
      .where('c.vigente', '=', true)
      .where('o.cerrada_at', 'is', null)
      .where('i.vigente', '=', true)
      .execute();

    return groupRowsByRefillRequestId(rows).map(toSolicitudElegible);
  }

  /**
   * D10 — "¿esta empresa fue alguna vez elegible sobre alguna solicitud de
   * este usuario?". A propósito SIN predicado `vigente`: es una relación
   * histórica ("ever"), no el estado actual — un match previo sin
   * aceptación igual califica al destinatario para `enviarOfertaProactiva`.
   */
  async existeRelacion(companyId: string, userId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('offer_opportunities as o')
      .innerJoin('offer_opportunity_companies as c', 'c.refill_request_id', 'o.refill_request_id')
      .select('o.refill_request_id')
      .where('o.user_id', '=', userId)
      .where('c.company_id', '=', companyId)
      .limit(1)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * D12 — cierra la oportunidad tras `aceptarOferta`. `tx` REQUERIDO
   * (D-G.5), misma clase de operación que `reemplazar`. Idempotente y
   * monótono por construcción: el `WHERE cerrada_at IS NULL` hace que una
   * segunda corrida sea un `UPDATE` de 0 filas, nunca un chequeo previo ni
   * un error — y nadie más vuelve a poner `cerrada_at` en `NULL` (D-A.3).
   */
  async cerrar(refillRequestId: string, tx: TransactionContext): Promise<void> {
    await toKyselyTransaction(tx)
      .updateTable('offer_opportunities')
      .set({ cerrada_at: new Date().toISOString() })
      .where('refill_request_id', '=', refillRequestId)
      .where('cerrada_at', 'is', null)
      .execute();
  }
}

// ============================================================
// Row -> domain mappers
// ============================================================

interface OpportunityItemRow {
  refill_item_id: string;
  nombre: string;
  categoria: string;
  precio_referencia: string;
  catalog_product_id: string | null;
}

/**
 * `offer_opportunity_items` row -> `RefillItem`, 1:1 sin adaptación
 * (design.md D-G.1: "no es casualidad" — la proyección guarda exactamente
 * las columnas que `RefillItem` necesita, la firma congelada de
 * `CatalogQueryPort.buscarCoincidencias`). `precio_referencia` es
 * `numeric(12,2)` -> STRING del driver, NOT NULL en esta tabla (a
 * diferencia de `refill_items.precio_referencia`): `Number(...)` es seguro
 * acá por el contrato del evento, no por suerte (design.md's numeric
 * callout).
 */
function toRefillItem(row: OpportunityItemRow): RefillItem {
  return {
    id: row.refill_item_id,
    nombre: row.nombre,
    categoria: row.categoria,
    precioReferencia: Number(row.precio_referencia),
    catalogProductId: row.catalog_product_id ?? undefined,
  };
}

interface SolicitudElegibleJoinRow {
  refill_request_id: string;
  comuna: string;
  urgencia: RefillUrgenciaRow;
  matched_at: string;
  refill_item_id: string;
  nombre: string;
  categoria: string;
  precio_referencia: string;
  catalog_product_id: string | null;
}

function toSolicitudElegibleItem(row: SolicitudElegibleJoinRow): SolicitudElegibleItem {
  return {
    refillItemId: row.refill_item_id,
    nombre: row.nombre,
    categoria: row.categoria,
    precioReferencia: Number(row.precio_referencia),
    catalogProductId: row.catalog_product_id ?? undefined,
  };
}

/** Agrupa las filas ya-joineadas de `listarPorCompany` por `refill_request_id`,
 *  preservando el orden de primera aparición — mismo patrón que
 *  `groupRowsByOfferId` de `KyselyOfferRepository` (PR3a). */
function groupRowsByRefillRequestId(
  rows: readonly SolicitudElegibleJoinRow[],
): SolicitudElegibleJoinRow[][] {
  const groups = new Map<string, SolicitudElegibleJoinRow[]>();
  for (const row of rows) {
    const group = groups.get(row.refill_request_id);
    if (group) {
      group.push(row);
    } else {
      groups.set(row.refill_request_id, [row]);
    }
  }
  return [...groups.values()];
}

function toSolicitudElegible(rows: SolicitudElegibleJoinRow[]): SolicitudElegible {
  const first = rows[0]!;
  return {
    refillRequestId: first.refill_request_id,
    comuna: first.comuna,
    urgencia: first.urgencia,
    matchedAt: first.matched_at,
    items: rows.map(toSolicitudElegibleItem),
  };
}
