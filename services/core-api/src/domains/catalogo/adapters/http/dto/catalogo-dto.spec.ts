import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { ActualizarPrecioDto } from './actualizar-precio.dto';
import { NuevoProductoDto } from './nuevo-producto.dto';

// `main.ts`'s global `ValidationPipe` runs `class-validator` with
// `whitelist: true, forbidNonWhitelisted: true` — mirrored here directly
// (not through the full Nest pipe), same convention as
// `identidad/adapters/http/dto/identidad-dto.spec.ts`.
const STRICT_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

function hasConstraint(errors: ValidationError[], property: string): boolean {
  return errors.some((error) => error.property === property);
}

describe('NuevoProductoDto', () => {
  const valid = {
    nombre: 'Agua Purificada 5L',
    categoria: 'Bebidas',
    precioBase: 1000,
    precioMaximo: 1500,
    stock: 10,
  };

  it('accepts a valid minimal payload (D8: no companyId field to populate)', async () => {
    const dto = plainToInstance(NuevoProductoDto, valid);
    expect(await validate(dto, STRICT_OPTIONS)).toHaveLength(0);
  });

  it('accepts a full payload with all optional fields set', async () => {
    const dto = plainToInstance(NuevoProductoDto, {
      ...valid,
      catalogProductId: '11111111-1111-4111-8111-111111111111',
      disponible: false,
      imagenUrl: 'https://example.com/img.png',
    });
    expect(await validate(dto, STRICT_OPTIONS)).toHaveLength(0);
  });

  it('rejects an empty nombre', async () => {
    const dto = plainToInstance(NuevoProductoDto, { ...valid, nombre: '' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'nombre')).toBe(true);
  });

  it('rejects an empty categoria', async () => {
    const dto = plainToInstance(NuevoProductoDto, { ...valid, categoria: '' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'categoria')).toBe(true);
  });

  it('rejects a negative precioBase', async () => {
    const dto = plainToInstance(NuevoProductoDto, { ...valid, precioBase: -1 });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'precioBase')).toBe(true);
  });

  it('rejects a non-finite precioMaximo (Infinity)', async () => {
    const dto = plainToInstance(NuevoProductoDto, { ...valid, precioMaximo: Infinity });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'precioMaximo')).toBe(true);
  });

  it('rejects a NaN precioBase (e.g. a malformed CSV cell cast with Number())', async () => {
    const dto = plainToInstance(NuevoProductoDto, { ...valid, precioBase: NaN });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'precioBase')).toBe(true);
  });

  it('rejects a non-integer stock', async () => {
    const dto = plainToInstance(NuevoProductoDto, { ...valid, stock: 1.5 });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'stock')).toBe(true);
  });

  it('rejects a negative stock', async () => {
    const dto = plainToInstance(NuevoProductoDto, { ...valid, stock: -1 });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'stock')).toBe(true);
  });

  it('rejects a client-supplied companyId (D8: no such field exists on the DTO)', async () => {
    const dto = plainToInstance(NuevoProductoDto, { ...valid, companyId: 'company-b' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'companyId')).toBe(true);
  });

  it('rejects an unknown extra field (mirrors main.ts forbidNonWhitelisted)', async () => {
    const dto = plainToInstance(NuevoProductoDto, { ...valid, unexpected: true });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'unexpected')).toBe(true);
  });
});

describe('ActualizarPrecioDto', () => {
  const valid = { precioBase: 1000, precioMaximo: 1500 };

  it('accepts a valid payload', async () => {
    const dto = plainToInstance(ActualizarPrecioDto, valid);
    expect(await validate(dto, STRICT_OPTIONS)).toHaveLength(0);
  });

  it('rejects a negative precioMaximo', async () => {
    const dto = plainToInstance(ActualizarPrecioDto, { ...valid, precioMaximo: -1 });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'precioMaximo')).toBe(true);
  });

  it('rejects a client-supplied companyId (D8: no such field exists on the DTO)', async () => {
    const dto = plainToInstance(ActualizarPrecioDto, { ...valid, companyId: 'company-b' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'companyId')).toBe(true);
  });

  it('rejects an unknown extra field (mirrors main.ts forbidNonWhitelisted)', async () => {
    const dto = plainToInstance(ActualizarPrecioDto, { ...valid, unexpected: true });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'unexpected')).toBe(true);
  });
});
