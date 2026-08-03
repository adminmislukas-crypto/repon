# supabase

Especificación del backend antes de escribir migraciones reales. Ver `docs/DATA_MODEL.md` para el mapa de relaciones.

## Tablas (a migrar en `migrations/`)

Orden sugerido de creación (respeta dependencias de foreign keys):

1. `companies`
2. `profiles` (FK opcional a `companies`)
3. `admin_roles` (FK a `profiles`)
4. `pets` (FK a `profiles`)
5. `catalog_products`
6. `provider_catalog` (FK a `companies`)
7. `user_consumption` (FK a `profiles`, `pets`)
8. `consumption_logs` (FK a `user_consumption`)
9. `refill_requests` (FK a `profiles`)
10. `refill_items` (FK a `refill_requests`)
11. `offers` (FK a `refill_requests`, `companies`)
12. `offer_items` (FK a `offers`, `refill_items`)
13. `orders` (FK a `offers`)
14. `order_items` (FK a `orders`)
15. `payments` (FK a `orders`)
16. `audit_log` (FK a `profiles`)

## Row Level Security — reglas por tabla

| Tabla | Regla |
|---|---|
| `profiles` | Cada usuario ve y edita solo su propia fila |
| `pets`, `user_consumption`, `consumption_logs` | Visibles solo para el `userId` dueño |
| `refill_requests`, `refill_items` | Visibles para el usuario dueño; visibles (solo lectura) para proveedores cuyo catálogo coincide y están en zona de despacho |
| `provider_catalog` | Editable solo por `profiles` con `companyId` correspondiente |
| `offers`, `offer_items` | El proveedor solo puede crear/editar sus propias ofertas; el usuario solo puede leer las ofertas dirigidas a sus solicitudes |
| `orders`, `payments` | Visibles solo para el usuario y el proveedor involucrados en ese pedido |
| `admin_roles`, `audit_log` | Sin acceso desde clave pública — solo alcanzables vía `service role key` desde `admin-web` |

**Nota:** ninguna tabla admite `DELETE` desde el cliente. Todas las bajas son un `UPDATE` de `status`.

## Edge Functions

| Función | Dispara | Hace |
|---|---|---|
| `match-refill-request` | Al crear una `refill_request` | Busca `provider_catalog` compatible por categoría + zona, genera ofertas automáticas para proveedores con auto-oferta activada |
| `check-consumption-stock` | Cron diario (`pg_cron`) | Recalcula días de stock restante por `user_consumption`, dispara notificación si está bajo, o genera `refill_request` automática si el usuario lo activó |
| `find-proactive-opportunities` | Cron diario | Detecta usuarios próximos a refill (por `user_consumption`) y las expone a proveedores en su sección de "solicitudes proactivas" |
| `payment-webhook` | Callback de Webpay/MercadoPago | Verifica el pago, crea el `order` a partir de la `offer` aceptada, notifica al proveedor |

## Checklist antes de escribir la primera migración real

- [ ] Confirmar nombres finales de columnas contra `packages/types/SPEC.md`
- [ ] Definir índices sobre `refill_requests.userId`, `offers.refillRequestId`, `provider_catalog.companyId` (consultas más frecuentes)
- [ ] Escribir las políticas RLS como parte de la misma migración que crea la tabla, no después
