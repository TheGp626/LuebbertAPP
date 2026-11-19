-- Rollback for 20261106_order_staffing: drops the table and its policies (entered MA numbers are lost).
drop table if exists public.order_staffing;
