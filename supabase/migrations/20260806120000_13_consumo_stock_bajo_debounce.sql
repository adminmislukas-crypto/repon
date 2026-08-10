-- Batch 13 -- consumo: marcador de debounce del chequeo diario de stock.
-- Delta declarado sobre db-schema-consumo (backend-core-api-consumo D5/Q1).
-- Solo seccion 2 del layout estandar: cero tablas, cero enums, cero RLS.

alter table public.user_consumption
  add column stock_bajo_notificado_at timestamptz;

comment on column public.user_consumption.stock_bajo_notificado_at is
  'Marcador de debounce del chequeo diario de stock (backend-core-api-consumo D5/Q1, design.md D-A). NULL = no hay alerta abierta; non-NULL = el cron ya emitio StockBajoDetectado (y RefillAutoSolicitado si correspondia) en ese instante y no vuelve a emitir hasta que la condicion se resuelva. Lo escribe UNICAMENTE procesarConsumosVencidos, via compare-and-set (UPDATE ... WHERE stock_bajo_notificado_at IS NULL RETURNING id) -- nunca via save(), que pisaria un decremento de stock concurrente. Lo limpian el propio cron al detectar stock por encima del umbral, y configurarConsumo al reconfigurar el item. Ningun otro dominio lo lee ni lo escribe. Es timestamptz y no boolean a proposito: habilita una politica futura de "re-alertar a los N dias" sin migracion.';
