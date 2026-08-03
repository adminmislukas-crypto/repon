# admin-web

Panel de administración interno. Next.js (App Router), no mobile.

**Mockup de referencia:** aún no generado. Ver `docs/ROADMAP.md` — Fase 0.

## Diferencia clave de arquitectura respecto a las apps móviles

Las apps de usuario y proveedor acceden a Supabase directo desde el cliente con la clave pública (`anon key`), limitadas por RLS. `admin-web` es la única pieza del sistema con acceso total: las acciones sensibles pasan por API routes de Next.js que corren en el servidor y usan la `service role key`. Esa clave nunca se expone al navegador ni se usa desde el cliente. Ver `docs/ARCHITECTURE.md`.

## Roles (tabla `admin_roles`)

| Rol | Puede |
|---|---|
| `super_admin` | Todo, incluyendo dar de alta/baja empresas y usuarios |
| `soporte` | Ver todo, sin permisos de baja |
| `finanzas` | Ver transacciones y exportar, sin acceso a dar de baja |

## Pantallas

### Dashboard
KPIs: usuarios activos, empresas activas, GMV del mes, pedidos del día, alertas (empresas con reclamos abiertos, pagos fallidos)

### Usuarios
- Tabla filtrable (estado, fecha de registro)
- Vista de detalle: datos personales, historial de pedidos, mascotas/consumo configurado
- Acción: suspender / reactivar (nunca borrado físico — ver regla de `status` en `docs/ARCHITECTURE.md`)

### Empresas
- Tabla filtrable (estado: `pendiente` / `activo` / `suspendido`)
- **Flujo de aprobación**: una empresa nueva queda en `pendiente` hasta que un admin revisa RUT y giro comercial y la aprueba — no puede vender ni aparecer en el marketplace antes de eso
- Vista de detalle: catálogo cargado, ofertas enviadas, rating
- Acción: aprobar / suspender / reactivar

### Transacciones por empresa
- Tabla filtrable por empresa, fecha y estado, con exportación a CSV
- Detalle de cada pedido (productos, presentación entregada — incluyendo si fue una presentación alternativa a la solicitada — monto, comisión)

### Auditoría
- Registro de cada acción administrativa: quién, sobre qué entidad, qué cambió, cuándo
- Solo lectura, ni siquiera `super_admin` puede editar este historial

## Pendiente
- Generar mockup HTML de estas 5 pantallas (mismo criterio visual que los mockups mobile, pero layout de escritorio/tabla)
- Definir política RLS específica para `admin_roles` y cómo las API routes verifican el rol antes de ejecutar una acción
- Definir qué acciones quedan detrás de una confirmación explícita (ej. suspender una empresa con pedidos en curso)
