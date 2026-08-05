# core-api

Backend de dominio. NestJS, organizado como **monolito modular con arquitectura hexagonal por dominio**. Sustituye el acceso directo de las apps a Supabase con RLS (ver `supabase/SPEC.md`, ahora limitado a Auth, Storage y Postgres como infraestructura) por una capa de negocio explícita que las apps consumen vía API.

## Por qué monolito modular y no microservicios desde el día uno

Seis dominios de negocio, cada uno con arquitectura hexagonal interna (puertos de entrada, puertos de salida, el dominio no conoce la infraestructura concreta), pero desplegados como un solo proceso. Cuando un dominio necesite escalar distinto a los demás, se extrae a su propio servicio cambiando únicamente sus adaptadores — el `EventEmitter` interno de Nest por un broker externo (NATS/RabbitMQ), y su repositorio en memoria/módulo compartido por su propia base de datos. El dominio (los casos de uso, las entidades, las reglas) no se toca.

## Estructura de carpetas

```
core-api/
├── SPEC.md                    ← este archivo
└── domains/
    ├── identidad/SPEC.md
    ├── catalogo/SPEC.md
    ├── consumo/SPEC.md
    ├── refill-matching/SPEC.md
    ├── ofertas/SPEC.md
    └── pedidos-pagos/SPEC.md
```

Cada `domains/<nombre>/SPEC.md` sigue el mismo formato: responsabilidad, entidades que posee, puertos de entrada, puertos de salida, eventos que publica, eventos que consume, y qué cambia el día que se extraiga como microservicio.

## Convenciones comunes a los 6 dominios

- **Nadie escribe en las tablas de otro dominio.** Si `Ofertas` necesita saber el precio base de un producto, no hace un `JOIN` a la tabla de `Catálogo` — consulta su puerto de salida (`CatalogQueryPort`), que hoy es una llamada interna y mañana puede ser una llamada HTTP o un caché local alimentado por eventos.
- **Toda comunicación entre dominios es por eventos**, salvo consultas de solo lectura que sí pueden ser síncronas a través de un puerto explícito (ver ejemplo de `Ofertas` → `Catálogo` arriba). Nunca un dominio importa el repositorio de otro directamente.
- **Los puertos de entrada son casos de uso**, no verbos CRUD genéricos (`CrearSolicitudRefill`, no `refillRequests.create()`). Esto es lo que hace que el dominio sea legible sin conocer la base de datos.
- **Cada dominio define sus propios eventos** con nombre en pasado (`OfertaAceptada`, no `AceptarOferta` — ese es el puerto de entrada). El nombre del evento es el contrato público hacia los demás dominios; cambiarlo es un cambio breaking.

## Bus de eventos interno (fase monolito)

`EventEmitter2` de NestJS. Cada dominio se suscribe solo a los eventos que le interesan (ver "eventos que consume" en cada `SPEC.md`). Esto es exactamente lo que se reemplaza por el broker externo al extraer un dominio.

## Infraestructura compartida (no es un dominio de negocio)

- **Auth** — adaptador hacia Supabase Auth, usado como puerto de salida desde `identidad`
- **Notificaciones push** — adaptador hacia Expo Push, usado como puerto de salida desde `consumo`, `ofertas` y `pedidos-pagos`
- **Pasarela de pago** — adaptador hacia Webpay/MercadoPago, usado solo desde `pedidos-pagos`
- **Auditoría** — `AuditLogPort`/`AUDIT_LOG_PORT` (`shared/audit/`), servicio transversal usado por cualquier dominio que mute una fila con actor admin, no un ports-out de `identidad` (`backend-core-api-foundation` design.md D-C). `entity_type` es polimórfico por diseño; `cambios` fija la forma `{ campo: { antes, despues } }` una sola vez para los 6 dominios.

## Delta implementado por `backend-core-api-foundation` (tasks.md fase 5.3)

Las secciones que siguen documentan código real (`services/core-api/src/`), no son prosa aspiracional — reflejan lo que `identidad` ya implementa y lo que los otros 5 dominios (por ahora placeholders vacíos, D2) deben seguir cuando se construyan.

### Convención de carpetas por dominio (`core-api-hexagonal-layout` spec)

Cada `domains/<nombre>/` bajo `src/` contiene, cuando el dominio está completo: `domain/` (entidades/factories, cero imports de framework), `ports-in/` (una clase por caso de uso), `ports-out/` (interfaces + tokens de DI), `contracts/` (solo si el dominio expone un puerto de consulta síncrona u otra implementación hacia otro dominio — p. ej. `identidad/contracts/IdentidadActorAdapter` implementando `ActorPort`), `adapters/{http,persistence,events}/`, y `<nombre>.module.ts`. Los 5 dominios placeholder (fase 5) solo tienen `ports-out/` + `<nombre>.module.ts` todavía — el resto llega con su propio cambio SDD.

### Regla de import cross-dominio, CI-enforced

"Nadie escribe en las tablas de otro dominio" (arriba) tiene ahora un mecanismo concreto: **solo `domains/<nombre>/contracts/` es importable cruzando el borde de un dominio.** Ningún archivo fuera de `domains/<nombre>/` — ni siquiera el shared kernel — puede importar `domains/<nombre>/{ports-out,adapters/persistence,adapters/events,domain}/**`. La regla la enforce ESLint (`import-x/no-restricted-paths`, `eslint.config.js`, zonas generadas dinámicamente leyendo `src/domains/` en disco) además de code review; los boundary tags de Nx quedan fuera de alcance (D1).

### `AuthenticatedActor` nunca cruza `ports-in`

El actor autenticado (`shared/auth/ports/actor.port.ts`) lo resuelve `AuthGuard` una vez por request y lo lee el controlador vía `@Actor()`; el controlador pasa **escalares** (`actor.profileId`, nunca el objeto completo) al caso de uso. Ningún `ports-in` de ningún dominio recibe `AuthenticatedActor` como parámetro — mantiene las firmas de los 6 `SPEC.md` de dominio intactas y evita que una capa de dominio re-derive autoridad de un objeto que no controla.

### Política de testing

| Capa | Qué cubre | Corre en CI |
|---|---|---|
| Unit (`*.spec.ts`) | Casos de uso con ports-out mockeados, entidades/invariantes de dominio, guards (`AuthGuard`/`RolesGuard`), verificadores JWT, DTOs, mappers, filtro de excepciones | Sí |
| E2e (`test/*.e2e-spec.ts`) | Rutas HTTP reales vía `Test.createTestingModule` + `supertest`, con solo los ports-out del dominio bajo prueba sobreescritos (`overrideProvider`) — no requiere Supabase local | Sí |
| Integration (`test/*.integration-spec.ts`) | Repositorios Kysely reales, rollback de `TransactionManager`, grants de `service_role` (`UPDATE`/`DELETE` rechazados sobre `audit_log`) | No — opt-in vía `pnpm test:integration`, requiere `supabase start` local |

`strict_tdd` (`openspec/config.yaml`) es `true` desde el cierre de este cambio (fase 5.6) — todo código nuevo en `core-api` sigue RED→GREEN→REFACTOR a partir de acá.
