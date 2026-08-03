# Repón 🔔

App de gestión de compras recurrentes (medicamentos, alimentos y consumo de mascotas) con un marketplace donde distintos proveedores ofertan para entregar el pedido.

## Sobre el nombre

**Repón** viene de "reponer" — el gesto central de la app: reponer stock antes de quedarte sin él. La 🔔 en el nombre/logo representa la otra mitad de la propuesta: los recordatorios de horario y dosis (medicamentos, alimento de mascotas) que la app gestiona junto con el reabastecimiento.

En el código y en esta documentación se mantiene la palabra técnica **"refill"** para el dominio y los tipos (`RefillRequest`, `refill-matching`, etc.) porque es vocabulario interno ya establecido — no es el nombre público de la app, que de cara al usuario siempre es **Repón 🔔**.

## Estructura del monorepo

```
repon/
├── docs/                     ← especificación general del producto
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   └── ROADMAP.md
├── apps/
│   ├── usuario-mobile/        ← app del comprador (React Native + Expo)
│   │   ├── SPEC.md
│   │   └── mockups/usuario.html
│   ├── proveedor-mobile/      ← app del proveedor (React Native + Expo)
│   │   ├── SPEC.md
│   │   └── mockups/proveedor.html
│   └── admin-web/             ← panel de administración (Next.js)
│       └── SPEC.md
├── services/
│   └── core-api/              ← monolito modular, arquitectura hexagonal por dominio
│       ├── SPEC.md
│       └── domains/
│           ├── identidad/SPEC.md
│           ├── catalogo/SPEC.md
│           ├── consumo/SPEC.md
│           ├── refill-matching/SPEC.md
│           ├── ofertas/SPEC.md
│           └── pedidos-pagos/SPEC.md
├── packages/
│   ├── types/SPEC.md          ← tipos TypeScript compartidos
│   └── ui/SPEC.md             ← componentes compartidos
└── supabase/
    ├── SPEC.md                ← ahora solo Auth, Storage y Postgres como infraestructura
    ├── migrations/            ← SQL de las tablas (a generar)
    └── functions/             ← Edge Functions (a generar)
```

## Cómo usar este repo con SDD

Cada carpeta bajo `apps/` y `packages/` tiene un `SPEC.md`: ese es el contrato antes de escribir código. El flujo recomendado:

1. Lee `docs/ARCHITECTURE.md` y `docs/DATA_MODEL.md` primero — son la base de todo.
2. Antes de tocar un app, lee su `SPEC.md`. Ahí están las pantallas, el estado que maneja y las reglas de negocio específicas (ej. presentación alternativa en ofertas).
3. Los mockups en `mockups/*.html` son la referencia visual y de interacción — el código de producción debe replicar ese comportamiento, no inventar uno nuevo.
4. Antes de tocar un dominio de negocio, lee `services/core-api/domains/<dominio>/SPEC.md` — define sus puertos de entrada/salida y qué eventos publica y consume. Las apps no deberían llamar a Supabase directo para lógica de negocio; llaman a `core-api`.
5. `supabase/SPEC.md` define las tablas antes de escribir migraciones reales.

## Stack

| Capa | Tecnología |
|---|---|
| Apps móviles | React Native + Expo, NativeWind, TanStack Query, Zustand |
| Panel admin | Next.js (App Router) |
| Backend de dominio | NestJS — monolito modular, arquitectura hexagonal por dominio (`services/core-api`) |
| Infraestructura | Supabase (Auth, Postgres, Storage, Realtime) |
| Pagos | Webpay Plus (Transbank) o MercadoPago Checkout Pro — checkout hospedado, nunca se captura tarjeta en el cliente |
| Notificaciones | Expo Push Notifications |

## Estado del proyecto

Fase actual: **mockups de alta fidelidad** (`apps/usuario-mobile/mockups/usuario.html`, `apps/proveedor-mobile/mockups/proveedor.html`). Siguiente paso: implementar `supabase/SPEC.md` como migraciones reales y arrancar `apps/usuario-mobile` en Expo.
