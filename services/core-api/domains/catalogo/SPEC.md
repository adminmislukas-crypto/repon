# Dominio: Catálogo

Productos de referencia (lo que ve el usuario en el buscador) y catálogo específico de cada proveedor con su precio base.

## Entidades que posee

- `CatalogProduct` (catálogo general de referencia)
- `ProviderCatalogItem` (producto cargado por un proveedor: precio base, precio máximo, stock, disponibilidad)

## Puertos de entrada (casos de uso)

```ts
interface CatalogoInboundPort {
  buscarProductos(query: string, categoria?: string): Promise<CatalogProduct[]>
  cargarProductoCatalogo(companyId: string, companyStatus: CompanyStatus, producto: NuevoProductoProveedor): Promise<ProviderCatalogItem>
  cargarCatalogoMasivo(companyId: string, companyStatus: CompanyStatus, archivo: ArchivoCarga): Promise<ResultadoCargaMasiva>
  actualizarPrecio(companyId: string, companyStatus: CompanyStatus, itemId: string, precioBase: number, precioMaximo: number): Promise<void>
  ajustarPreciosPorCategoria(companyId: string, companyStatus: CompanyStatus, categoria: string, porcentaje: number): Promise<void>
}
```

**Delta `backend-core-api-catalogo` (D7/D8/D-E)** — las 4 firmas mutantes cambian frente a la versión original de este SPEC.md:

- **`actualizarPrecio` gana `companyId`** (no tenía ninguno): sin él, cualquier proveedor autenticado podía mutar el precio de un ítem de otra empresa adivinando `itemId`. El caso de uso verifica `item.companyId === companyId` antes de escribir; si no coincide (o el ítem no existe), responde **404** — nunca 403, para no confirmar por enumeración que el ítem existe y es de otra empresa.
- **Las 4 firmas ganan `companyStatus`**: un proveedor cuya empresa no está `'activo'` no puede mutar el catálogo — se rechaza antes de cualquier lectura/escritura. Una regla, cuatro aplicaciones (D8/D-E), no cuatro reglas distintas.
- **`companyId`/`companyStatus` los deriva siempre el actor autenticado**, nunca un valor que el cliente pueda enviar en el body — ningún DTO HTTP tiene un campo `companyId`.

## Puertos de salida

```ts
interface CatalogRepository {
  save(item: ProviderCatalogItem, tx?: TransactionContext): Promise<void>
  saveMany(items: ProviderCatalogItem[], tx?: TransactionContext): Promise<void>
  findById(itemId: string, tx?: TransactionContext): Promise<ProviderCatalogItem | null>
  findByCompany(companyId: string, tx?: TransactionContext): Promise<ProviderCatalogItem[]>
  findByCompanyAndCategoria(companyId: string, categoria: string, tx?: TransactionContext): Promise<ProviderCatalogItem[]>
  findMatching(categoria: string, nombre: string, tx?: TransactionContext): Promise<ProviderCatalogItem[]>   // única lectura de CatalogRepository con el filtro de visibilidad (ver abajo)
}
interface CatalogProductRepository {   // delta backend-core-api-catalogo: gap no nombrado por el diseño original
  buscar(query: string, categoria?: string): Promise<CatalogProduct[]>
}
interface CatalogVisibilityProjection {   // delta backend-core-api-catalogo (D9): escritor de la proyección de visibilidad
  ocultarEmpresa(companyId: string, motivo: string | null, tx?: TransactionContext): Promise<void>
  mostrarEmpresa(companyId: string, tx?: TransactionContext): Promise<void>
}
interface EventPublisher {
  publish(event: DomainEvent): Promise<void>
}
```

**Delta `backend-core-api-catalogo`**: `CatalogRepository` gana `findById` (D7, ownership check de `actualizarPrecio`), `saveMany` (D4, nace con forma de lote para `ajustarPreciosPorCategoria`) y `findByCompanyAndCategoria`. `buscarProductos` lee un dominio distinto (`catalog_products`, sin dimensión de empresa) y por eso tiene su propio puerto, `CatalogProductRepository` — plegarlo en `CatalogRepository` habría mezclado dos tablas estructuralmente distintas bajo una sola interfaz. `CatalogVisibilityProjection` es el puerto de escritura de la proyección desnormalizada que mantiene oculto el catálogo de una empresa suspendida (ver "Eventos que consume").

## Consulta que expone a otros dominios (síncrona, solo lectura)

```ts
interface CatalogQueryPort {   // usado por refill-matching y ofertas — vive en domains/catalogo/contracts/
  buscarCoincidencias(itemsSolicitados: RefillItem[], companyId?: string): Promise<ProviderCatalogItem[]>
}
```

**Delta `backend-core-api-catalogo` (D1/D-B)**: `CatalogQueryPort` es el primer contrato cross-dominio *propiedad de un dominio* (no del kernel) del repo — interfaz + token viven en `contracts/`, la clase concreta en `adapters/persistence/`. Ante una falla de infraestructura (DB caída, timeout, pool agotado) **lanza** `CatalogQueryUnavailableError` — nunca degrada a `[]`, porque una lista vacía ya es una respuesta de negocio válida ("ningún proveedor tiene este producto") y no puede confundirse con "no se pudo consultar".

## Eventos que publica

- `ProductoAgregado`
- `PrecioActualizado`
- `CatalogoCargaMasivaCompletada`
- `PreciosCategoriaAjustados` (delta `backend-core-api-catalogo`, D6) — `{ companyId, categoria, porcentaje, totalActualizados }`. Un evento resumen por invocación de `ajustarPreciosPorCategoria`, nunca uno por ítem — mismo motivo que `CatalogoCargaMasivaCompletada` evita el evento por fila en la carga masiva.

## Eventos que consume

- `EmpresaAprobada` (de `identidad`) — habilita a esa empresa a cargar catálogo (verificado en tiempo real vía `companyStatus` del actor, sin estado cacheado) **y** restaura la visibilidad de su catálogo en lecturas cross-tenant si la empresa venía oculta (delta `backend-core-api-catalogo`: `aprobarEmpresa` no tiene precondición de estado, así que puede sacar a una empresa de `suspendido`).
- `EmpresaSuspendida` (de `identidad`) — oculta el catálogo de esa empresa **de las lecturas cross-tenant** (`CatalogQueryPort.buscarCoincidencias`, `CatalogRepository.findMatching`). **Corrección de alcance** (delta `backend-core-api-catalogo`, D-A): NO afecta `buscarProductos` (lee `catalog_products`, que no tiene columna de empresa) ni `findByCompany` (el proveedor siempre ve su propio catálogo, esté o no suspendido).
- `EmpresaReactivada` (de `identidad`, delta `backend-core-api-catalogo` D16) — restaura la visibilidad, mismo tratamiento que `EmpresaAprobada`.

## Al extraer como microservicio independiente

Candidato natural cuando la carga masiva o la búsqueda empiecen a pesar más que el resto (es la tabla con más volumen de escritura — cientos de productos por proveedor). El `CatalogQueryPort` que hoy es una llamada interna se convierte en una llamada HTTP síncrona o, mejor, en una tabla de lectura desnormalizada que `refill-matching` mantiene actualizada escuchando `PrecioActualizado`.
