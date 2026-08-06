import { parse } from 'csv-parse/sync';
import type { ArchivoCarga, FilaCarga, NuevoProductoProveedor } from '@repon/types';
import { ArchivoCargaInvalidoError } from '../../domain/catalogo.errors';

/**
 * `POST /catalogo/mi-catalogo/carga-masiva`'s multipart field name (design.md
 * "Superficie HTTP" / Diagram 1, P1). Not consumed by any route yet — that
 * route is Phase 5b's job (`cargarCatalogoMasivoUseCase` + the controller
 * method). When it lands, it wires `@UseInterceptors(FileInterceptor(
 * CARGA_MASIVA_FILE_FIELD, { limits: { fileSize: CARGA_MASIVA_MAX_BYTES } }))`
 * on that method — this constant is the single source of truth for the field
 * name so the interceptor and `parseArchivoCarga` below can never drift
 * apart, and the multer-level `fileSize` limit is a first line of defense
 * ahead of (never a replacement for) the envelope check this file performs.
 */
export const CARGA_MASIVA_FILE_FIELD = 'archivo';

/**
 * Envelope limits (design.md Diagram 1, P1). Declared as placeholders, not
 * measurements: `spec.md`'s "Open item deferred beyond this spec" defers the
 * exact numeric thresholds to `sdd-design` (proposal Q4), and design.md's own
 * "Riesgos residuales" list names them as unmeasured defaults. The only
 * non-negotiable property is that they are finite (same rationale as D-B's
 * pool/statement timeouts).
 */
export const CARGA_MASIVA_MIMETYPE_ESPERADO = 'text/csv';
export const CARGA_MASIVA_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const CARGA_MASIVA_MIN_FILAS = 1;
export const CARGA_MASIVA_MAX_FILAS = 500;

/**
 * `NuevoProductoProveedor` columns the header MUST contain. A subset check,
 * not an exact-match: `catalogProductId`/`disponible`/`imagenUrl` are
 * optional on `NuevoProductoProveedor` itself (`@repon/types`), so a provider
 * who never uses them is not forced to include an always-empty column.
 * Column order in the uploaded file is irrelevant — values are looked up by
 * header name, matching how `csv-parse`'s own `columns: true` mode resolves
 * fields (see the "matches columns by header name, not by position" test).
 */
const COLUMNAS_REQUERIDAS = ['nombre', 'categoria', 'precioBase', 'precioMaximo', 'stock'] as const;

/**
 * The subset of `Express.Multer.File` the parser actually reads. Kept
 * narrow (not the full Multer type) so a unit test can build a fake without
 * every disk-storage-only field Multer's own interface carries — the parser
 * itself never imports `Express.Multer.File` by name, only by shape.
 */
export interface ArchivoCargaEnvelope {
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

/**
 * Envelope validation + CSV parsing for `cargarCatalogoMasivo` (design.md
 * Diagram 1, P1 + P2). Lives in `adapters/http/` — never `ports-in`/`domain`
 * — per D11: those layers must never see a framework buffer type, and this
 * function's return type (`ArchivoCarga`, from `@repon/types`) is already
 * framework-free.
 *
 * Two responsibilities, deliberately not three:
 * 1. ENVELOPE checks (mimetype, size, row count, header shape) — a failure
 *    here throws `ArchivoCargaInvalidoError` and the caller (Phase 5b's
 *    controller) maps it to 400 `ARCHIVO_CARGA_INVALIDO` before
 *    `cargarCatalogoMasivo` ever runs: nothing is written, nothing is
 *    emitted.
 * 2. FORM-ONLY row mapping — column values are cast with `Number()` for the
 *    numeric fields (`NaN` is an acceptable output, not an error). VALUE
 *    validation (a negative price, an empty `nombre`, a duplicate-within-file
 *    identity) is explicitly NOT this function's job — it happens per row,
 *    later, in `cargarCatalogoMasivoUseCase` (Phase 5b), specifically so one
 *    malformed row can never invalidate the whole file (D2).
 */
export function parseArchivoCarga(file: ArchivoCargaEnvelope): ArchivoCarga {
  if (file.mimetype !== CARGA_MASIVA_MIMETYPE_ESPERADO) {
    throw new ArchivoCargaInvalidoError(
      `Tipo de archivo inválido: se esperaba "${CARGA_MASIVA_MIMETYPE_ESPERADO}", se recibió "${file.mimetype}".`,
    );
  }
  if (file.size > CARGA_MASIVA_MAX_BYTES) {
    throw new ArchivoCargaInvalidoError(
      `El archivo excede el tamaño máximo permitido de ${CARGA_MASIVA_MAX_BYTES} bytes.`,
    );
  }

  const rows = parseRawRows(file.buffer);
  if (rows.length === 0) {
    throw new ArchivoCargaInvalidoError(
      'El archivo está vacío: no se encontró una fila de cabecera.',
    );
  }

  const [header, ...dataRows] = rows;
  const columnasFaltantes = COLUMNAS_REQUERIDAS.filter((columna) => !header.includes(columna));
  if (columnasFaltantes.length > 0) {
    throw new ArchivoCargaInvalidoError(
      `Cabecera de archivo inválida: faltan las columnas ${columnasFaltantes.join(', ')}.`,
    );
  }

  if (dataRows.length < CARGA_MASIVA_MIN_FILAS || dataRows.length > CARGA_MASIVA_MAX_FILAS) {
    throw new ArchivoCargaInvalidoError(
      `El archivo debe tener entre ${CARGA_MASIVA_MIN_FILAS} y ${CARGA_MASIVA_MAX_FILAS} filas de datos (tiene ${dataRows.length}).`,
    );
  }

  const filas: FilaCarga[] = dataRows.map((row, index) => ({
    // 1-based, excluding the header row (design.md Diagram 1) — the
    // identifier `ResultadoCargaMasiva.fallos[].numero` reports back per row
    // (Phase 5b), so it must line up with what the provider sees in their
    // own file.
    numero: index + 1,
    producto: mapRowAProducto(header, row),
  }));

  return { filas };
}

function parseRawRows(buffer: Buffer): string[][] {
  try {
    // No `columns: true` here, deliberately: with zero data rows, csv-parse
    // in `columns` mode cannot distinguish "header present, zero data rows"
    // from "no header at all" — both collapse to an empty array. Parsing
    // raw rows first keeps the header check and the row-count check as two
    // independently testable, independently throwing branches.
    return parse(buffer, { skip_empty_lines: true, trim: true }) as string[][];
  } catch (cause) {
    throw new ArchivoCargaInvalidoError('El archivo no pudo ser interpretado como CSV.', {
      cause: cause as Error,
    });
  }
}

function mapRowAProducto(header: string[], row: string[]): NuevoProductoProveedor {
  const valores = new Map(header.map((columna, i) => [columna, row[i]]));
  const catalogProductId = valores.get('catalogProductId');
  const disponible = valores.get('disponible');
  const imagenUrl = valores.get('imagenUrl');

  return {
    catalogProductId: catalogProductId ? catalogProductId : undefined,
    nombre: valores.get('nombre') ?? '',
    categoria: valores.get('categoria') ?? '',
    // `Number('')` is `0`, not `NaN` — an empty numeric cell must still read
    // as malformed downstream (Phase 5b), never silently become a valid 0.
    // `Number(undefined)` is already `NaN`, so only the empty-string case
    // needs the explicit `|| NaN` override; a genuine `'0'` cell is a
    // non-empty string and passes through untouched.
    precioBase: Number(valores.get('precioBase') || NaN),
    precioMaximo: Number(valores.get('precioMaximo') || NaN),
    stock: Number(valores.get('stock') || NaN),
    disponible:
      disponible !== undefined && disponible !== ''
        ? disponible.trim().toLowerCase() === 'true'
        : undefined,
    imagenUrl: imagenUrl ? imagenUrl : undefined,
  };
}
