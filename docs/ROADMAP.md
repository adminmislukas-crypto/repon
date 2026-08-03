# Roadmap

## Fase 0 — Mockups (actual)
- [x] Mockup `usuario-mobile` — dashboard, consumos, refill (buscar + crear), ofertas, perfil
- [x] Mockup `proveedor-mobile` — dashboard, solicitudes reactivas/proactivas, catálogo, precios, pedidos
- [ ] Mockup `admin-web` — dashboard, usuarios, empresas, transacciones, auditoría

## Fase 1 — Fundaciones técnicas
- [ ] Proyecto Supabase creado, migraciones de `docs/DATA_MODEL.md` aplicadas
- [ ] Políticas RLS por tabla
- [ ] Proyecto Expo inicial (`apps/usuario-mobile`) con navegación calcada del mockup
- [ ] Autenticación (registro/login) funcionando

## Fase 2 — Flujo core (usuario)
- [ ] Búsqueda de productos + armado de refill
- [ ] Módulo de consumo (dosis, porciones, recordatorios) con tabs persona/mascota
- [ ] Historial y perfil

## Fase 3 — Flujo core (proveedor)
- [ ] Carga de catálogo (individual y masiva)
- [ ] Motor de matching (Edge Function) — solicitud ↔ catálogo por categoría y zona
- [ ] Pantallas de oferta (reactiva y proactiva), incluyendo presentación alternativa

## Fase 4 — Tiempo real y pagos
- [ ] Bandeja de ofertas con Supabase Realtime
- [ ] Integración de checkout hospedado (Webpay o MercadoPago)
- [ ] Notificaciones push (Expo)

## Fase 5 — Administración
- [ ] `admin-web` en Next.js con roles (`super_admin`, `soporte`, `finanzas`)
- [ ] Flujo de aprobación de empresas
- [ ] Dashboard de transacciones y auditoría

## Fase 6 — Automatización
- [ ] Cron de cálculo de stock/consumo (`pg_cron`)
- [ ] Refill automático cuando el usuario lo activa
- [ ] Ofertas proactivas automáticas para proveedores con auto-oferta activada
