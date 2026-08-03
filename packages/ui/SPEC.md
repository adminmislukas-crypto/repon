# packages/ui

Componentes visuales compartidos entre `usuario-mobile` y `proveedor-mobile`. Extraídos de los patrones repetidos en los mockups HTML — el objetivo es que un mismo componente sirva para ambas apps, ya que comparten el mismo lenguaje visual (mismas variables de color, mismos badges, mismas tarjetas).

## Componentes a extraer del mockup

| Componente | Basado en (clase del mockup) | Usado en |
|---|---|---|
| `ProductRow` | `.row` + `.ico` + `.meta` + `.badge` | Lista de productos, catálogo, carrito de refill |
| `StatCard` | `.stat-card` / `.scard` | Dashboards de ambas apps |
| `StatusBadge` | `.badge` (`bd-red`, `bd-amb`, `bd-grn`, `bd-pur`, `bd-blu`) | Estados de stock, pedidos, ofertas |
| `OfferCard` | `.offer-card` / `.inbox-card` | Bandeja de ofertas (usuario) y solicitudes (proveedor) |
| `AltPresentationNote` | `.alt-explain` / `.alt-note` | Nota de presentación alternativa — **debe ser el mismo componente en ambas apps** para que el mensaje se vea igual del lado que lo escribe y del lado que lo recibe |
| `ProgressBar` | `.pbar` / `.pfill` | Días de stock restante, tratamientos con duración |
| `OwnerTabs` | `.owner-tab` / `.otab` | Selector persona/mascota en Consumos |
| `BottomNav` | `.nav` / `.nb` | Navegación principal de ambas apps |

## Sistema de color (ya usado consistentemente en los mockups)

Reutilizar las variables CSS definidas en los archivos HTML como tokens de NativeWind/Tailwind config:

- `accent` (púrpura, `#534AB7`) — acciones primarias en la app de usuario
- Verde teal (`#0F6E56`) — identidad visual de la app de proveedor
- `danger` / `warn` / `ok` — estados de stock y badges, consistentes en ambas apps

## Nota de implementación

No crear estos componentes desde cero: partir del HTML/CSS ya validado en los mockups y convertirlo a JSX + StyleSheet (o NativeWind), manteniendo los mismos nombres de estado visual (`urgente`, `pronto`, `ok`) para no introducir inconsistencia entre lo que ya se diseñó y lo que se construye.
