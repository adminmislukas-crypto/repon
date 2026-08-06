import { ArchivoCargaInvalidoError } from '../../domain/catalogo.errors';
import {
  CARGA_MASIVA_MAX_BYTES,
  CARGA_MASIVA_MAX_FILAS,
  CARGA_MASIVA_MIMETYPE_ESPERADO,
  parseArchivoCarga,
} from './carga-masiva.parser';

// design.md Diagram 1, P1: the exact 8 `NuevoProductoProveedor` keys, in the
// order a provider-facing template would list them. Column ORDER is not
// significant to the parser (matched by name, not position — see the
// dedicated test below) — this constant just keeps the fixtures below
// readable.
const REQUIRED_HEADER =
  'catalogProductId,nombre,categoria,precioBase,precioMaximo,stock,disponible,imagenUrl';

interface FakeMulterFile {
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function csvFile(options: { mimetype?: string; size?: number; content: string }): FakeMulterFile {
  const buffer = Buffer.from(options.content, 'utf-8');
  return {
    mimetype: options.mimetype ?? CARGA_MASIVA_MIMETYPE_ESPERADO,
    size: options.size ?? buffer.length,
    buffer,
  };
}

function filaValida(nombre = 'Producto', overrides: Partial<Record<string, string>> = {}): string {
  const columnas: Record<string, string> = {
    catalogProductId: '',
    nombre,
    categoria: 'Categoria',
    precioBase: '1000',
    precioMaximo: '1500',
    stock: '10',
    disponible: 'true',
    imagenUrl: '',
    ...overrides,
  };
  return [
    columnas.catalogProductId,
    columnas.nombre,
    columnas.categoria,
    columnas.precioBase,
    columnas.precioMaximo,
    columnas.stock,
    columnas.disponible,
    columnas.imagenUrl,
  ].join(',');
}

describe('parseArchivoCarga — envelope validation (design.md Diagram 1, P1)', () => {
  it('rejects a file whose mimetype is not text/csv', () => {
    const file = csvFile({
      mimetype: 'application/vnd.ms-excel',
      content: `${REQUIRED_HEADER}\n${filaValida()}`,
    });

    expect(() => parseArchivoCarga(file)).toThrow(ArchivoCargaInvalidoError);
  });

  it('rejects a file larger than the size limit', () => {
    const file = csvFile({
      size: CARGA_MASIVA_MAX_BYTES + 1,
      content: `${REQUIRED_HEADER}\n${filaValida()}`,
    });

    expect(() => parseArchivoCarga(file)).toThrow(ArchivoCargaInvalidoError);
  });

  it('rejects a completely empty file (no header, no rows)', () => {
    const file = csvFile({ content: '' });

    expect(() => parseArchivoCarga(file)).toThrow(ArchivoCargaInvalidoError);
  });

  it('rejects a file with zero data rows (header only)', () => {
    const file = csvFile({ content: REQUIRED_HEADER });

    expect(() => parseArchivoCarga(file)).toThrow(ArchivoCargaInvalidoError);
  });

  it('rejects a file with more than the maximum allowed data rows', () => {
    const filas = Array.from({ length: CARGA_MASIVA_MAX_FILAS + 1 }, (_, i) =>
      filaValida(`Producto ${i}`),
    );
    const file = csvFile({ content: [REQUIRED_HEADER, ...filas].join('\n') });

    expect(() => parseArchivoCarga(file)).toThrow(ArchivoCargaInvalidoError);
  });

  it('rejects a header missing a required column', () => {
    const headerSinNombre =
      'catalogProductId,categoria,precioBase,precioMaximo,stock,disponible,imagenUrl';
    const file = csvFile({ content: `${headerSinNombre}\n,Categoria,1000,1500,10,true,` });

    expect(() => parseArchivoCarga(file)).toThrow(ArchivoCargaInvalidoError);
  });

  it('rejects a header that shares none of the required columns', () => {
    const file = csvFile({ content: 'id,name,price\n1,foo,10' });

    expect(() => parseArchivoCarga(file)).toThrow(ArchivoCargaInvalidoError);
  });
});

describe('parseArchivoCarga — successful parse (design.md Diagram 1, P2)', () => {
  it('maps every data row to a 1-based numero, excluding the header row', () => {
    const file = csvFile({
      content: [REQUIRED_HEADER, filaValida('Producto A'), filaValida('Producto B')].join('\n'),
    });

    const archivo = parseArchivoCarga(file);

    expect(archivo.filas).toHaveLength(2);
    expect(archivo.filas[0]).toMatchObject({ numero: 1 });
    expect(archivo.filas[1]).toMatchObject({ numero: 2 });
  });

  it('maps optional columns whether present or absent on a given row', () => {
    const file = csvFile({
      content: [
        REQUIRED_HEADER,
        'cp-1,Agua Purificada,Bebidas,1000,1500,10,true,https://example.com/agua.png',
        ',Alimento Perro,Mascotas,2000,2500,5,false,',
      ].join('\n'),
    });

    const archivo = parseArchivoCarga(file);

    expect(archivo.filas[0].producto).toEqual({
      catalogProductId: 'cp-1',
      nombre: 'Agua Purificada',
      categoria: 'Bebidas',
      precioBase: 1000,
      precioMaximo: 1500,
      stock: 10,
      disponible: true,
      imagenUrl: 'https://example.com/agua.png',
    });
    expect(archivo.filas[1].producto).toEqual({
      catalogProductId: undefined,
      nombre: 'Alimento Perro',
      categoria: 'Mascotas',
      precioBase: 2000,
      precioMaximo: 2500,
      stock: 5,
      disponible: false,
      imagenUrl: undefined,
    });
  });

  // D2/PR 5b's own scope boundary: the parser only maps columns to keys and
  // casts numerics with Number() — it does NOT decide whether NaN is
  // acceptable. That decision belongs to cargarCatalogoMasivo, per row,
  // later. A malformed cell must never fail the whole file here.
  it('casts numeric columns with Number(), allowing NaN for a malformed cell — no value validation at this stage', () => {
    const file = csvFile({
      content: [REQUIRED_HEADER, 'x,Producto Malo,Categoria,no-es-numero,1500,10,true,'].join('\n'),
    });

    const archivo = parseArchivoCarga(file);

    expect(archivo.filas).toHaveLength(1);
    expect(Number.isNaN(archivo.filas[0].producto.precioBase)).toBe(true);
    // A malformed cell taints only its own field, never a sibling field on
    // the same row and never the rest of the file.
    expect(archivo.filas[0].producto.precioMaximo).toBe(1500);
  });

  it('matches columns by header name, not by position', () => {
    const reordered = 'nombre,precioBase,precioMaximo,stock,categoria';
    const file = csvFile({
      content: [reordered, 'Producto Reordenado,1000,1500,10,Categoria'].join('\n'),
    });

    const archivo = parseArchivoCarga(file);

    expect(archivo.filas[0].producto).toMatchObject({
      nombre: 'Producto Reordenado',
      categoria: 'Categoria',
      precioBase: 1000,
      precioMaximo: 1500,
      stock: 10,
    });
  });
});
