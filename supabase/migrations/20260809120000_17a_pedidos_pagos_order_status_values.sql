-- Batch 17a -- pedidos-pagos: los 2 valores que le faltan a order_status
-- (design.md D-A.1, C2/R1). Delta declarado sobre db-schema-pedidos-pagos.
-- NO edita 20260803120600_06_pedidos_pagos.sql: fix-forward (D5).
--
-- ESTE ARCHIVO CONTIENE SOLO ALTER TYPE, A PROPOSITO -- misma restriccion
-- que obligo a partir 14/15: el valor agregado no puede USARSE hasta que
-- esta transaccion commitee. El batch 17b nombra 'pendiente_pago' en un
-- comment y podria querer usarlo en un indice parcial mañana, asi que la
-- separacion es estructural, no defensiva. No agregar aca ningun default,
-- CHECK, backfill ni indice.
--
-- POSICION: los dos ANTES de 'confirmado', anclados contra 'confirmado'
-- (valor preexistente), nunca uno contra el otro. Orden resultante:
--   expirado < pendiente_pago < confirmado < preparando < en_camino < entregado
-- Asi `status >= 'confirmado'` significa "ya pagado y en marcha". Con
-- 'expirado' al final, ese mismo predicado incluiria pedidos NUNCA pagados.
-- No es reversible: quitar un valor de un enum exige recrear el tipo.

alter type public.order_status add value 'expirado'       before 'confirmado';
alter type public.order_status add value 'pendiente_pago' before 'confirmado';
