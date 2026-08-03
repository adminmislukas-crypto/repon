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
