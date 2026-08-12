# Dominio: Refill y matching

Recibe las solicitudes de refill armadas por el usuario (o generadas automáticamente por `consumo`) y encuentra qué proveedores son compatibles para que puedan ofertar.

## Entidades que posee

- `RefillRequest` — unión discriminada sobre `estado`: `'borrador'` / `'abierta'` / `'ofertada'` / `'confirmada'` (delta `backend-core-api-refill-matching`, D3). El 4º estado, `'borrador'`, es una solicitud incompleta (D4): nace sin `direccion`/`comuna`, y sus ítems pueden nacer sin `categoria`/`precioReferencia` — nunca aparece en el matching (409 explícito si se intenta, ver "Puertos de entrada" más abajo). Solo transiciona a `'abierta'` cuando se completa; desde ahí sigue la máquina de 3 estados que ya existía.
- `RefillItem` — ítem COMPLETO (el único que el matching acepta; su forma no cambió). Un borrador usa `RefillItemBorrador` en su lugar, un tipo hermano con `categoria`/`precioReferencia` opcionales — nunca una variante de `RefillItem` (delta D-B: `RefillItem` se mantiene congelado a propósito, porque `catalogo/contracts/catalog-query.port.ts` ya lo usa en su firma y ese contrato no se toca en este cambio).

## Puertos de entrada (casos de uso)

```ts
interface RefillInboundPort {
  crearSolicitud(items: NuevoRefillItem[], direccion: string, comuna: string, urgencia: Urgencia): Promise<RefillRequest>
  completarBorrador(refillRequestId: string, direccion: string, comuna: string, urgencia: Urgencia | undefined, items: CompletarRefillItemInput[]): Promise<RefillRequest>
  buscarProveedoresCompatibles(refillRequestId: string): Promise<ProviderCatalogItem[]>
  marcarComoOfertada(refillRequestId: string): Promise<void>
  marcarComoConfirmada(refillRequestId: string): Promise<void>
}
```

**El dueño se deriva SIEMPRE del actor autenticado, nunca de un parámetro que el llamador controle** (delta D13): ninguno de los 5 casos de uso de arriba recibe `userId` como argumento explícito ni lo acepta en un body/DTO — el `RefillController` (`adapters/http/`) siempre pasa `actor.profileId`, resuelto por el `AuthGuard` a partir del token, nunca un valor que un cliente pueda falsificar. `crearSolicitud` ganó además el parámetro `comuna` (delta D12): antes solo tomaba `direccion`, y una solicitud sin comuna no es matchable (D1 la persiste desde el día 1 aunque este cambio no la use todavía para filtrar). Cualquier acceso cross-tenant (`refillRequestId` de otro usuario, o inexistente) devuelve el mismo error de "no encontrado" — nunca un 403 que confirme la existencia ajena.

Un 6º caso de uso, `crearBorradorRefill`, existe SOLO como reacción interna a `RefillAutoSolicitado` (ver "Eventos que consume" más abajo) — no forma parte de `RefillInboundPort` porque no tiene ruta HTTP ni actor humano que lo invoque.

## Puertos de salida

```ts
interface RefillRepository {
  save(request: RefillRequest): Promise<void>
  findById(id: string): Promise<RefillRequest | null>
  findBorradorByConsumption(userId: string, consumptionId: string): Promise<RefillRequestBorrador | null>
  actualizarEstado(id: string, estado: RefillEstadoActivo): Promise<void>
}
interface EventPublisher {
  publish(event: DomainEvent): Promise<void>
}
```

`findBorradorByConsumption` y `actualizarEstado` son incorporaciones de este cambio (delta D-G.2): la primera sirve la deduplicación del listener de `RefillAutoSolicitado` (un borrador abierto por `(userId, consumptionId)`, nunca dos); la segunda es la transición pura de estado que usan `marcarComoOfertada`/`marcarComoConfirmada` — una sentencia angosta que nunca reescribe `RefillItem`, a diferencia de `save()`.

Usa `CatalogQueryPort` (expuesto por `catalogo`, ver su `SPEC.md`) para el matching — no tiene su propio repositorio de catálogo.

## Eventos que publica

- `RefillCreado` — marca la entrada de una solicitud a `'abierta'`, no el insert de la fila (delta D-G.3/D-C): se publica después de `crearSolicitud` (camino manual) y también después de `completarBorrador` (`'borrador' -> 'abierta'`), pero NUNCA al crear un borrador. `ofertas` lo escucha para conocer la solicitud, pero esta lista de proveedores compatibles NO viaja acá — ver `MatchEncontrado` abajo. Corrección declarada: la versión anterior de este documento decía que `RefillCreado` servía para "notificar a los proveedores compatibles", lo cual es imposible — cuando se publica este evento el matching todavía no corrió.
- `MatchEncontrado` — el evento que SÍ lleva la lista de proveedores compatibles (`companyIds`, `providerCatalogItemIds`), publicado por `buscarProveedoresCompatibles` después de consultar `CatalogQueryPort`. Se publica también con `companyIds: []` cuando no hay coincidencias — nunca se suprime, porque "no hay proveedores" es un hecho accionable distinto de "el matching nunca corrió".

## Eventos que consume

- `RefillAutoSolicitado` (de `consumo`) — dispara `crearBorradorRefill`, un caso de uso interno sin ruta HTTP (delta D-G.1), NUNCA `crearSolicitud`: bajo D3/D12, `crearSolicitud` exige `direccion`/`comuna` (que el sistema no tiene al reaccionar a este evento) y produce una solicitud `'abierta'` (que D3 prohíbe para este camino). `crearBorradorRefill` deduplica por `(userId, consumptionId)` — si ya existe un borrador abierto para ese consumo, no crea uno nuevo ni publica nada. Corrección declarada: la versión anterior de este documento decía que este evento disparaba `crearSolicitud`.

`EmpresaSuspendida` (de `identidad`) NO se consume acá (delta D5) — corrección declarada sobre una versión anterior de este documento, que sí la listaba. La exclusión de empresas suspendidas/ocultas ya ocurre transitivamente dentro de `CatalogQueryPort.buscarCoincidencias` (el anti-join contra `catalog_hidden_companies` que `catalogo` mantiene, disparado por su propio listener de `EmpresaSuspendida`) — este dominio nunca necesita su propia suscripción al mismo evento.

## Al extraer como microservicio independiente

Su única dependencia externa real es la consulta a `catalogo`. Al extraerlo, esa consulta síncrona se reemplaza por una caché local de `provider_catalog` que este servicio mantiene actualizada escuchando `PrecioActualizado` y `ProductoAgregado` — así el matching no depende de la disponibilidad del servicio de catálogo en tiempo real.
