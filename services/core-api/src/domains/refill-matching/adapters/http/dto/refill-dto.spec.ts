import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { CrearSolicitudDto } from './crear-solicitud.dto';
import { NuevoRefillItemDto } from './nuevo-refill-item.dto';

// `main.ts`'s global `ValidationPipe` runs `class-validator` with
// `whitelist: true, forbidNonWhitelisted: true` — mirrored here directly
// (not through the full Nest pipe), same convention as
// `catalogo/adapters/http/dto/catalogo-dto.spec.ts` /
// `identidad/adapters/http/dto/identidad-dto.spec.ts`.
const STRICT_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

function hasConstraint(errors: ValidationError[], property: string): boolean {
  return errors.some((error) => error.property === property);
}

const validItem = { nombre: 'Losartan 50mg', categoria: 'Medicamentos', precioReferencia: 5990 };

describe('NuevoRefillItemDto', () => {
  it('accepts a valid minimal payload', async () => {
    const dto = plainToInstance(NuevoRefillItemDto, validItem);
    expect(await validate(dto, STRICT_OPTIONS)).toHaveLength(0);
  });

  it('accepts precioReferencia: 0 (boundary, never rejected)', async () => {
    const dto = plainToInstance(NuevoRefillItemDto, { ...validItem, precioReferencia: 0 });
    expect(await validate(dto, STRICT_OPTIONS)).toHaveLength(0);
  });

  it('accepts a valid catalogProductId (uuid)', async () => {
    const dto = plainToInstance(NuevoRefillItemDto, {
      ...validItem,
      catalogProductId: '11111111-1111-4111-8111-111111111111',
    });
    expect(await validate(dto, STRICT_OPTIONS)).toHaveLength(0);
  });

  it('rejects an empty nombre', async () => {
    const dto = plainToInstance(NuevoRefillItemDto, { ...validItem, nombre: '' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'nombre')).toBe(true);
  });

  it('rejects an empty categoria', async () => {
    const dto = plainToInstance(NuevoRefillItemDto, { ...validItem, categoria: '' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'categoria')).toBe(true);
  });

  it('rejects a negative precioReferencia', async () => {
    const dto = plainToInstance(NuevoRefillItemDto, { ...validItem, precioReferencia: -1 });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'precioReferencia')).toBe(true);
  });

  it('rejects a non-uuid catalogProductId', async () => {
    const dto = plainToInstance(NuevoRefillItemDto, {
      ...validItem,
      catalogProductId: 'not-a-uuid',
    });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'catalogProductId')).toBe(true);
  });
});

describe('CrearSolicitudDto', () => {
  const valid = {
    items: [validItem],
    direccion: 'Av. Siempre Viva 742',
    comuna: 'Providencia',
    urgencia: 'hoy',
  };

  it('accepts a valid minimal payload', async () => {
    const dto = plainToInstance(CrearSolicitudDto, valid);
    expect(await validate(dto, STRICT_OPTIONS)).toHaveLength(0);
  });

  it('rejects an empty items array', async () => {
    const dto = plainToInstance(CrearSolicitudDto, { ...valid, items: [] });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'items')).toBe(true);
  });

  it('rejects an item with a negative precioReferencia, nested', async () => {
    const dto = plainToInstance(CrearSolicitudDto, {
      ...valid,
      items: [{ ...validItem, precioReferencia: -1 }],
    });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'items')).toBe(true);
  });

  it('rejects an empty direccion', async () => {
    const dto = plainToInstance(CrearSolicitudDto, { ...valid, direccion: '' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'direccion')).toBe(true);
  });

  it('rejects an empty comuna', async () => {
    const dto = plainToInstance(CrearSolicitudDto, { ...valid, comuna: '' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'comuna')).toBe(true);
  });

  it('rejects a missing comuna entirely', async () => {
    const { comuna: _comuna, ...withoutComuna } = valid;
    const dto = plainToInstance(CrearSolicitudDto, withoutComuna);
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'comuna')).toBe(true);
  });

  it('rejects an urgencia outside the enum', async () => {
    const dto = plainToInstance(CrearSolicitudDto, { ...valid, urgencia: 'ya-mismo' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'urgencia')).toBe(true);
  });

  it('rejects a client-supplied userId — the class declares no such field (D13)', async () => {
    const dto = plainToInstance(CrearSolicitudDto, {
      ...valid,
      userId: '11111111-1111-4111-8111-111111111111',
    });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'userId')).toBe(true);
  });
});
