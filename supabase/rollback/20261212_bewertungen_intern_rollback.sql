-- Rollback of 20261212_bewertungen_intern (the ratings are lost).
drop function if exists public.set_staff_ratings(uuid, jsonb);
drop table if exists public.staff_ratings;
