# Arquitectura

## Vista general

Tres tipos de cliente hablan con la capa de dominio (`services/core-api`), no directo con Supabase:

```
App usuario (Expo)  ──┐
App proveedor (Expo) ─┼─► core-api (NestJS) ──► Postgres, Auth, Storage (Supabase)
Panel admin (Next.js)─┘   monolito modular, hexagonal por dominio
```

- **Apps móviles y panel admin** llaman a `core-api` por HTTP para toda operación con reglas de negocio (crear un refill, enviar una oferta, aprobar una empresa). Ninguna toca Postgres directo salvo lecturas simples que no tienen lógica asociada.
- **`core-api`** es un monolito modular: seis dominios de negocio, cada uno con arquitectura hexagonal interna (dominio aislado de infraestructura mediante puertos), comunicados entre sí por eventos. Ver `services/core-api/SPEC.md` y `services/core-api/domains/*/SPEC.md` para el detalle de cada uno.
- **Supabase** pasa a ser infraestructura pura: hosting de Postgres, Auth (como adaptador desde el dominio `identidad`), Storage y Realtime (para las notificaciones en vivo de la bandeja de ofertas).

## Backend — Supabase (infraestructura, no lógica de negocio)

| Servicio | Para qué se usa |
|---|---|
| Auth | Registro y sesión de usuarios y proveedores |
| Postgres + RLS | Toda la data: perfiles, mascotas, consumo, catálogos, solicitudes, ofertas, pedidos |
| Realtime | Las ofertas de proveedores llegan a la bandeja del usuario sin recargar |
| Edge Functions | Motor de matching (solicitud ↔ catálogo de proveedores), cron diario de stock/consumo, webhooks de pago |
| Storage | Fotos de productos, comprobantes |

## Servicios externos

- **Notificaciones push** — Expo Push Notifications, disparadas desde Edge Functions
- **Pagos** — Webpay Plus (Transbank) o MercadoPago Checkout Pro. El flujo usa checkout hospedado: el número de tarjeta nunca toca nuestro servidor, evitando el alcance de cumplimiento PCI-DSS
- **Mapas / despacho** — cálculo de zonas y tiempos de entrega

## Capa de dominio — de monolito modular a microservicios

Los seis dominios (`identidad`, `catalogo`, `consumo`, `refill-matching`, `ofertas`, `pedidos-pagos`) viven hoy en un solo proceso NestJS, comunicados por un bus de eventos interno (`EventEmitter2`). Cada uno respeta arquitectura hexagonal: el dominio no conoce Postgres, HTTP ni la pasarela de pago directamente, solo interactúa con ellos a través de puertos definidos en su `SPEC.md`.

Cuando un dominio necesite escalar distinto a los demás — típicamente `ofertas` o `pedidos-pagos`, los de mayor carga transaccional — se extrae a su propio servicio: el `EventEmitter` interno se reemplaza por un broker externo (NATS o RabbitMQ) y su repositorio pasa a tener su propia base de datos. Como los límites de dominio ya estaban respetados desde el monolito, esa extracción no toca las reglas de negocio, solo los adaptadores.

## Flujo central: de la solicitud al pedido

1. El usuario arma una solicitud de refill (productos + dirección + urgencia)
2. El motor de matching (Edge Function) busca proveedores compatibles por categoría, zona y catálogo cargado
3. Los proveedores ofertan — con precio, tiempo de entrega y, si corresponde, una **presentación alternativa** (ej. saco de 25kg en vez de 15kg, o 2 cajas x15 en vez de 1 caja x30)
4. Las ofertas llegan en tiempo real a la bandeja del usuario vía Realtime
5. El usuario acepta una oferta y paga mediante el checkout hospedado
6. Se crea el pedido y se notifica al proveedor por push

## Automatización de consumo

El cálculo de "cuántos días de stock quedan" (dosis × frecuencia vs. stock actual) vive en una Edge Function programada (`pg_cron`), no en el cliente, para que funcione aunque el usuario no tenga la app abierta. Si el usuario activó "auto-crear refill", esta misma función genera la solicitud automáticamente al llegar al mínimo.

## Estado en el cliente (apps móviles)

- **Zustand** (o Context simple) para estado de UI efímero: el refill en construcción, el tab activo (persona/mascota)
- **TanStack Query** para todo lo que viene del servidor: catálogo, ofertas, historial — maneja caché y sincroniza con Realtime sin lógica manual

## Principio de "dar de baja"

Ningún borrado físico (`DELETE`) sobre usuarios, empresas o productos. Todo pasa por un campo `status` (`activo` / `suspendido` / `eliminado`) para poder revertir errores y no perder el historial de transacciones, que además se necesita para contabilidad.
