import { ApiProperty } from '@nestjs/swagger';

/**
 * `POST /catalogo/mi-catalogo/carga-masiva`'s multipart/form-data body
 * (design.md Diagram 1, P1). Deliberately thin — a `class-validator`
 * decorator pass has no useful role here, because Nest's `FileInterceptor`
 * hands the controller a raw `Express.Multer.File`, not a JSON body this
 * class could validate field-by-field. ALL envelope validation (mimetype,
 * size, row count, header shape) and row-shape mapping happens in
 * `carga-masiva.parser.ts`'s `parseArchivoCarga()` (D11: `ports-in`/
 * `domain` never see this file, or even this DTO). This class exists
 * solely so `@ApiConsumes('multipart/form-data')` + `@ApiBody({ type:
 * CargaMasivaDto })` render the correct multipart form field in the
 * generated OpenAPI schema — the same "Swagger-only shape" role
 * `ProviderCatalogItemResponseDto`'s sibling response DTOs play, inverted.
 */
export class CargaMasivaDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: `Archivo CSV con las columnas ${'catalogProductId,nombre,categoria,precioBase,precioMaximo,stock,disponible,imagenUrl'}. Solo nombre/categoria/precioBase/precioMaximo/stock son obligatorias.`,
  })
  archivo!: unknown;
}
