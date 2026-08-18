# usuario-mobile

App del comprador. React Native + Expo.

**Mockup de referencia:** [`mockups/usuario.html`](./mockups/usuario.html) — abrir directamente en el navegador, es completamente navegable.

## Menú inferior (5 pestañas)

| Pestaña | Pantalla ancla | Contiene |
|---|---|---|
| Dashboard | `s-home` | Resumen del mes, alertas de stock, ahorro acumulado, banner de ofertas proactivas recibidas |
| Consumos | `s-consumo` | Dosis/porciones de hoy, con tabs para alternar entre el usuario y cada mascota |
| Refill | `s-buscar` → `s-refill-builder` | Buscar productos y armar la solicitud de refill en un mismo flujo |
| Ofertas | `s-inbox` | Bandeja de ofertas recibidas de proveedores |
| Perfil | `s-perfil` | Datos personales, dirección, método de pago, vista previa del historial |

## Pantallas secundarias (sin nav, acceso por botón atrás)

- `s-consumo-config`, `s-consumo-nuevo`, `s-consumo-nuevo-pet`, `s-consumo-historial`
- `s-refill-sent`, `s-resumen`, `s-pago`, `s-pago-ok`
- `s-historial` (listado completo, accedido desde Perfil)

## Reglas de negocio clave

### Consumo (dosis y porciones)
- Cada ítem de consumo pertenece al usuario o a una mascota (`owner_type`)
- Tipos: medicamento, alimento, vacuna/pipeta, suplemento — el formulario cambia campos según el tipo (ver `selectPetType()` en el mockup)
- Marcar una dosis como tomada/servida actualiza el stock proyectado y la racha de adherencia
- Si "auto-crear refill" está activado, al llegar al stock mínimo se genera la solicitud sin intervención del usuario

### Bandeja de ofertas
- Cada oferta puede incluir una **presentación alternativa** por producto (ej. proveedor sin el saco de 15kg ofrece uno de 25kg)
- Toda presentación distinta a la solicitada se marca visualmente (`alt-flag`) y muestra la comparación de precio unitario, nunca se oculta
- Aceptar una oferta lleva a `s-resumen` → `s-pago`, con el total recalculado según lo aceptado

### Pago
- El formulario de tarjeta en el mockup es solo representativo. En producción, ese paso se reemplaza por un checkout hospedado (Webpay/MercadoPago) — no se captura ni transmite el número de tarjeta desde esta app

## Estado que maneja el cliente

- Carrito de refill en construcción (`refillItems`) — Zustand
- Tab activo persona/mascota en Consumos — estado local de pantalla
- Catálogo, ofertas, historial — TanStack Query contra Supabase

## Autenticación (login) — cambio `mobile-auth-login`

- Pantalla `login.tsx` (sin nav, primera pantalla si no hay sesión): formulario email/password. Llama a `useSession().signIn` de `@repon/auth`, que golpea `POST /identidad/sesion` en `core-api` con `expectedRole: 'user'` — nunca contra Supabase directo.
- La sesión (`accessToken`/`refreshToken`/`perfil`) se persiste vía `expo-secure-store` en nativo y `localStorage` en web. `@repon/auth`'s `authFetch` la refresca proactivamente y en single-flight ante un 401.
- Guard: `RequireSession` envuelve `app/(tabs)/_layout.tsx` completo — sin sesión, redirige a `/login`; con sesión, renderiza el tab tree normal.
- Cada código de error del backend (`CREDENCIALES_INVALIDAS`, `PROFILE_SUSPENDED`, `ROL_NO_PERMITIDO`, `DEMASIADOS_INTENTOS`, `AUTH_PROVIDER_NO_DISPONIBLE`) se mapea a un mensaje en español distinto en pantalla — nunca revela si el problema fue el email o la contraseña.
- `companyStatus` (empresa `pendiente`/`suspendido`) no aplica a esta app: solo existe para `role: 'provider'`, ver `proveedor-mobile/SPEC.md`.

## Pendiente al migrar del mockup a Expo
- Reemplazar `go()` / `goBack()` (manipulación directa del DOM) por Expo Router
- Reemplazar el JS inline de simulación (`marcarDosis`, `aceptarOferta`, etc.) por mutaciones reales contra Supabase
- Conectar `s-inbox` a un canal de Supabase Realtime en vez de datos estáticos
