import { Module } from '@nestjs/common';

/**
 * Thin placeholder module (exploration.md D2). `ports-out/` declares this
 * domain's tokens/interfaces (`CATALOG_REPOSITORY`, `CATALOG_QUERY_PORT`)
 * but this module binds NEITHER — design.md, "Los 5 módulos placeholder
 * declaran tokens e interfaces pero NO los bindean. Nada los inyecta
 * todavía, así que un token sin proveedor es correcto. Prohibido
 * `useValue: {}`: un stub que no-opea en silencio es peor que un proveedor
 * faltante, que falla ruidosamente al boot." An empty `@Module({})` is the
 * literal expression of that rule — zero fake providers, nothing to throw
 * at DI-resolution time, and `AppModule` can import it today so a future
 * `catalogo` SDD change only has to add providers here, never touch
 * `app.module.ts` again.
 */
@Module({})
export class CatalogoModule {}
