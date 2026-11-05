-- Rollback for 20261105_beschaeftigungsart.sql (manual). Restore apply_app_settings from 20261102 state first if needed:
-- the personnel_rates branch is harmless to keep. Shifts written as "MA Minijob" etc. stay.
delete from public.app_settings where key = 'personnel_rates';
alter table public.app_users drop constraint if exists app_users_employment_type_check;
alter table public.app_users drop column if exists employment_type;
