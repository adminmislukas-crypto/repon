# Dominio: Refill y matching

Recibe las solicitudes de refill armadas por el usuario (o generadas automáticamente por `consumo`) y encuentra qué proveedores son compatibles para que puedan ofertar.

## Entidades que posee

- `RefillRequest` (`estado`: `abierta` / `ofertada` / `confirmada`)
- `RefillItem`

## Puertos de entrada (casos de uso)

```ts
interface RefillInboundPort {
  crearSolicitud(userId: string, items: NuevoRefillItem[], direccion: string, urgencia: Urgencia): Promise<RefillRequest>
  buscarProveedoresCompatibles(refillRequestId: string): Promise<ProviderCatalogItem[]>
  marcarComoOfertada(refillRequestId: string): Promise<void>
  marcarComoConfirmada(refillRequestId: string): Promise<void>
}
```

## Puertos de salida

```ts
interface RefillRepository {
  save(request: RefillRequest): Promise<void>
  findById(id: string): Promise<RefillRequest | null>
}
interface EventPublisher {
  publish(event: DomainEvent): Promise<void>
}
```

Usa `CatalogQueryPort` (expuesto por `catalogo`, ver su `SPEC.md`) para el matching — no tiene su propio repositorio de catálogo.

## Eventos que publica

- `RefillCreado` — lo escucha `ofertas` para notificar a los proveedores compatibles
- `MatchEncontrado` — lista de proveedores compatibles, también consumido por `ofertas`

## Eventos que consume

- `RefillAutoSolicitado` (de `consumo`) — dispara `crearSolicitud` sin intervención del usuario
- `EmpresaSuspendida` (de `identidad`) — excluye a esa empresa del resultado de matching

## Al extraer como microservicio independiente

Su única dependencia externa real es la consulta a `catalogo`. Al extraerlo, esa consulta síncrona se reemplaza por una caché local de `provider_catalog` que este servicio mantiene actualizada escuchando `PrecioActualizado` y `ProductoAgregado` — así el matching no depende de la disponibilidad del servicio de catálogo en tiempo real.
