# Modelo de datos

Referencia de las tablas principales en Postgres (Supabase). El detalle de columnas y RLS vive en `supabase/SPEC.md`; este documento es el mapa de alto nivel y las relaciones entre entidades.

## Identidad

- **profiles** — usuarios y proveedores comparten esta tabla, distinguidos por `role` (`user` | `provider` | `admin`). Referencia a `auth.users` de Supabase.
- **companies** — datos de la empresa proveedora (razón social, RUT, giro, `status`: `pendiente` / `activo` / `suspendido`). Un `profile` con `role = provider` pertenece a una `company`.
- **company_dispatch_zones** — comunas/regiones donde una `company` despacha (`company_id`, `comuna`, `region`, UNIQUE por `company_id`+`comuna`). Hereda la visibilidad RLS de su `company` padre.
- **admin_roles** — qué `profile` es `super_admin`, `soporte` o `finanzas`.

## Consumo (usuario)

- **pets** — mascotas del usuario (nombre, especie, raza, peso)
- **user_consumption** — configuración de dosis/porción, frecuencia, horarios y stock actual, para persona o mascota (`owner_type`: `self` | `pet`, con `pet_id` opcional)
- **consumption_logs** — cada toma o porción marcada como dada, usada para calcular adherencia y racha

## Catálogo y refill

- **catalog_products** — catálogo de referencia general (lo que aparece en el buscador del usuario)
- **provider_catalog** — productos que cada proveedor cargó, con precio base, precio máximo, stock y disponibilidad
- **refill_requests** + **refill_items** — la solicitud armada por el usuario (uno o más productos)

## Ofertas

- **offers** — oferta enviada por un proveedor a una `refill_request`, con tipo (`reactiva` | `proactiva`)
- **offer_items** — línea por producto dentro de una oferta. Campos clave para presentación alternativa:
  - `is_alt` (boolean)
  - `alt_size` / `alt_qty` (ej. 25kg × 1, o 15 unidades × 2)
  - `alt_note` (texto explicativo mostrado al usuario)

## Pedidos y pagos

- **orders** + **order_items** — se crean al aceptar una oferta
- **payments** — referencia a la transacción del checkout hospedado (id de Webpay/MercadoPago). Nunca se guardan datos de tarjeta.

## Administración

- **audit_log** — registro de toda acción administrativa: quién, sobre qué entidad, qué cambió y cuándo. Obligatorio desde el primer día, no se agrega después.

## Relaciones principales

```
profiles (role=user) ──┬── pets
                        ├── user_consumption ── consumption_logs
                        └── refill_requests ── refill_items

profiles (role=provider) ── companies ──┬── provider_catalog
                                         └── company_dispatch_zones

refill_requests ── offers ── offer_items
offers (aceptada) ── orders ── order_items ── payments

admin_roles ── profiles (role=admin) ── audit_log
```
