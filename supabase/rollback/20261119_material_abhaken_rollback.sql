-- Rollback of 20261119_material_abhaken. The app treats a missing order_checks / order_check_items as "Material abhaken
-- not available" and saves protocols without shortages when the column is gone. Ticked quantities are lost.
alter publication supabase_realtime drop table public.order_checks, public.protocols, public.shifts;
drop table if exists public.order_checks;
drop function if exists public.order_checks_stamp();
drop function if exists public.order_check_items(text);
drop function if exists public.order_check_mine(text, text[]);
alter table public.protocols drop column if exists shortages;
