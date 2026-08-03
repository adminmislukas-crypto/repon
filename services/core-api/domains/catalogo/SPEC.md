# Dominio: Catálogo

Productos de referencia (lo que ve el usuario en el buscador) y catálogo específico de cada proveedor con su precio base.

## Entidades que posee

- `CatalogProduct` (catálogo general de referencia)
- `ProviderCatalogItem` (producto cargado por un proveedor: precio base, precio máximo, stock, disponibilidad)

## Puertos de entrada (casos de uso)

```ts
interface CatalogoInboundPort {
  buscarProductos(query: string, categoria?: string): Promise<CatalogProduct[]>
  cargarProductoCatalogo(companyId: string, producto: NuevoProductoProveedor): Promise<ProviderCatalogItem>
  cargarCatalogoMasivo(companyId: string, archivo: ArchivoCarga): Promise<ResultadoCargaMasiva>
  actualizarPrecio(itemId: string, precioBase: number, precioMaximo: number): Promise<void>
  ajustarPreciosPorCategoria(companyId: string, categoria: string, porcentaje: number): Promise<void>
}
```

## Puertos de salida

```ts
interface CatalogRepository {
  save(item: ProviderCatalogItem): Promise<void>
  findByCompany(companyId: string): Promise<ProviderCatalogItem[]>
  findMatching(categoria: string, nombre: string): Promise<ProviderCatalogItem[]>
}
interface EventPublisher {
  publish(event: DomainEvent): Promise<void>
}
```

## Consulta que expone a otros dominios (síncrona, solo lectura)

```ts
interface CatalogQueryPort {   // usado por refill-matching y ofertas
  buscarCoincidencias(itemsSolicitados: RefillItem[], companyId?: string): Promise<ProviderCatalogItem[]>
}
```

## Eventos que publica

- `ProductoAgregado`
- `PrecioActualizado`
- `CatalogoCargaMasivaCompletada`

## Eventos que consume

- `EmpresaAprobada` (de `identidad`) — habilita a esa empresa a cargar catálogo
- `EmpresaSuspendida` (de `identidad`) — oculta el catálogo de esa empresa de toda búsqueda y matching

## Al extraer como microservicio independiente

Candidato natural cuando la carga masiva o la búsqueda empiecen a pesar más que el resto (es la tabla con más volumen de escritura — cientos de productos por proveedor). El `CatalogQueryPort` que hoy es una llamada interna se convierte en una llamada HTTP síncrona o, mejor, en una tabla de lectura desnormalizada que `refill-matching` mantiene actualizada escuchando `PrecioActualizado`.
