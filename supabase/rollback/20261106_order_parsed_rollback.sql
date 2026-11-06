-- Rollback for 20261106_order_parsed: drops the cache (PDFs are simply parsed again).
drop table if exists public.order_parsed;
