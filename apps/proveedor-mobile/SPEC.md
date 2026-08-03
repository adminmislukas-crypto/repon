# proveedor-mobile

App del proveedor. React Native + Expo.

**Mockup de referencia:** [`mockups/proveedor.html`](./mockups/proveedor.html) — abrir directamente en el navegador, es completamente navegable.

## Pantallas principales (con nav)

| Pantalla | Contiene |
|---|---|
| `screen-dashboard` | Métricas del día, solicitudes proactivas urgentes, solicitudes reactivas recientes |
| `screen-solicitudes` | Todas las solicitudes disponibles, separadas en proactivas (usuarios próximos a refill) y reactivas (solicitudes abiertas) |
| `screen-catalogo` | Catálogo del proveedor por categoría, con precio base |
| `screen-pedidos` | Pedidos en curso y entregados |

## Pantallas secundarias (sin nav, acceso por botón atrás)

- `screen-ofertar` (oferta reactiva), `screen-oferta-proactiva`, `screen-oferta-enviada`
- `screen-agregar-producto`, `screen-editar-producto`, `screen-carga-masiva`, `screen-precios`

## Reglas de negocio clave

### Catálogo
- Producto con precio base + precio máximo de oferta, stock y disponibilidad
- Carga individual o masiva (`.xlsx`/`.csv`, hasta 500 productos)
- Productos sin precio base quedan marcados y bloquean la oferta automática

### Oferta automática
- Cuando una solicitud entrante coincide con un producto del catálogo del proveedor, el sistema genera la oferta sola usando el precio base
- Solo requiere intervención manual cuando el producto no está en el catálogo

### Presentación alternativa (`screen-ofertar` y `screen-oferta-proactiva`)
Cada producto de la solicitud tiene un toggle "tengo esta presentación" / "no tengo esta presentación":
- Si no tiene la presentación exacta, el proveedor elige una alternativa (otro tamaño/cantidad) e ingresa el precio de esa alternativa
- El sistema calcula el precio por unidad/kilo y genera una nota explicativa automática, comparándolo contra la referencia
- El total de la oferta se recalcula en vivo (`recalcTotal()` en el mockup) sumando ítems exactos + ítems alternativos
- Esta nota y la marca de "presentación distinta" son lo que ve el usuario en su bandeja — nunca se envía sin dejarlo explícito

### Solicitudes proactivas
- Se generan cuando el motor de matching detecta usuarios próximos a quedarse sin stock (según su configuración de consumo)
- El proveedor puede ofertar antes de que el usuario pida explícitamente, con mensaje personalizado opcional

## Estado que maneja el cliente
- Formulario de oferta en construcción (por producto: exacto vs. alternativo, precio) — estado local de pantalla
- Catálogo, solicitudes, pedidos — TanStack Query contra Supabase

## Pendiente al migrar del mockup a Expo
- Reemplazar `go()` / `goBack()` por Expo Router
- `recalcTotal()`, `updateAltNote()`, `setAvail()` pasan de manipular el DOM a manejar estado de formulario (React Hook Form o estado local)
- Conectar `screen-solicitudes` a Realtime para que las solicitudes nuevas aparezcan sin refrescar
- La carga masiva (`.xlsx`/`.csv`) necesita parseo real (ej. `papaparse` o `xlsx`) y subida a Supabase Storage + inserción batch
