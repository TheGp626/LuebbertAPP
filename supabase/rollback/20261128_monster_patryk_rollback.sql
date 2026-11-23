-- Rollback of 20261128_monster_patryk.sql. The Heute page hides the counter when the function is missing.
drop function if exists public.monster_patryk();
