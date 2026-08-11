-- Batch 14 -- refill-matching: cuarto valor del enum refill_estado.
-- Delta declarado sobre db-schema-refill-matching (backend-core-api-refill-matching
-- D3 / design.md D-A). Solo seccion 1 del layout estandar: cero tablas, cero RLS.
--
-- ESTE ARCHIVO CONTIENE UNA SOLA SENTENCIA, A PROPOSITO. Desde PG12 un
-- `ALTER TYPE ... ADD VALUE` puede correr dentro de una transaccion, pero el
-- valor agregado NO puede USARSE hasta que esa transaccion commitee
-- (`unsafe use of new value ... of enum type`), y el runner de Supabase aplica
-- cada archivo en una transaccion. El batch 15 usa 'borrador' en el predicado
-- de un indice parcial, asi que DEBE ser un archivo aparte. No agregar aca
-- ningun CHECK, default, backfill ni indice que referencie el valor nuevo.
--
-- BEFORE 'abierta' y no al final: la posicion en el enum define el orden de
-- comparacion y de ORDER BY. 'borrador' precede a 'abierta' en el ciclo de
-- vida, asi que ponerlo antes hace que el orden de Postgres coincida con el
-- del dominio y que `estado >= 'abierta'` se lea como "ya es matchable".
-- No es reversible: quitar un valor de un enum exige recrear el tipo (R8).

alter type public.refill_estado add value 'borrador' before 'abierta';
