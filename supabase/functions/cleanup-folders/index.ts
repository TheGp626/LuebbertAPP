// cleanup-folders: deletes top-level project folders whose deletion date (project_folders.ends_on) has passed,
// with subfolders and files (experimental). Called daily by pg_cron; body is optional: { dry_run?: boolean }.
// A folder is only deleted after its storage files are gone: if the storage removal fails, the folder stays
// and the next run retries it, so no folder_files row ever points at a missing object.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { dueFolderTrees, storagePaths, chunk, hasUpcomingJob, pathsNotIn } from './cleanup.mjs';
import { loadSettings } from '../_shared/settings.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_PER_RUN = 20;
const BUCKET = 'project-files';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function berlinToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let input: { dry_run?: boolean } = {};
  try { const t = await req.text(); if (t.trim()) input = JSON.parse(t); } catch { return json({ error: 'invalid_json' }, 400); }
  const dryRun = input.dry_run === true;

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Admin switch: off → nothing is deleted (a dry run still reports what would be)
  const settings = await loadSettings(db);
  // A failed read would fall back to "on" – never delete on a guess
  if (!dryRun && (settings as Record<string, unknown>)._read_failed) { console.error('cleanup-folders: settings unreadable, nothing deleted'); return json({ error: 'settings_unavailable' }, 500); }
  if (!dryRun && !settings.folder_autodelete_enabled) return json({ skipped: 'disabled' });

  const { data: folders, error } = await db.from('project_folders').select('id, name, parent_id, ends_on');
  if (error) { console.error('cleanup-folders: load folders failed', error); return json({ error: 'db_error' }, 500); }
  const due = dueFolderTrees(folders || [], berlinToday()).slice(0, MAX_PER_RUN);

  const deleted: string[] = [];
  const report: { name: string; ends_on: string; file_count: number }[] = [];
  let skipped = 0;

  const today = berlinToday();
  for (const f of due) {
    // Safety: a folder that still has a planned job today or later is not deleted
    const { data: jobs, error: jErr } = await db.from('einsaetze').select('folder_id, date, cancelled')
      .in('folder_id', f.treeIds).eq('cancelled', false).gte('date', today);
    if (jErr) { console.error('cleanup-folders: load jobs failed', f.id, jErr); skipped++; continue; }
    if (hasUpcomingJob(f.treeIds, jobs || [], today)) {
      console.error('cleanup-folders: skipped, still has upcoming jobs:', f.name, f.id);
      skipped++; continue;
    }
    const { data: files, error: fErr } = await db.from('folder_files').select('file_url').in('folder_id', f.treeIds);
    if (fErr) { console.error('cleanup-folders: load files failed', f.id, fErr); skipped++; continue; }
    const paths = storagePaths((files || []).map((x: { file_url: string }) => x.file_url));
    if (dryRun) { report.push({ name: f.name, ends_on: f.ends_on, file_count: paths.length }); continue; }

    let storageFailed = false;
    for (const part of chunk(paths, 100)) {
      const { error: sErr } = await db.storage.from(BUCKET).remove(part);
      if (sErr) { console.error('cleanup-folders: storage remove failed', f.id, sErr); storageFailed = true; break; }
    }
    if (storageFailed) { skipped++; continue; }

    // Best effort: files uploaded since the first select would be orphaned in storage, remove them too
    const { data: late, error: lateErr } = await db.from('folder_files').select('file_url').in('folder_id', f.treeIds);
    if (lateErr) console.error('cleanup-folders: re-select files failed', f.id, lateErr);
    else {
      const extra = pathsNotIn(storagePaths((late || []).map((x: { file_url: string }) => x.file_url)), paths);
      for (const part of chunk(extra, 100)) {
        const { error: eErr } = await db.storage.from(BUCKET).remove(part);
        if (eErr) console.error('cleanup-folders: storage remove of late files failed', f.id, eErr);
      }
    }

    // Subfolders, files and jobs cascade via FK
    const { error: dErr } = await db.from('project_folders').delete().eq('id', f.id);
    if (dErr) { console.error('cleanup-folders: delete folder failed', f.id, dErr); skipped++; continue; }
    const { error: lErr } = await db.from('folder_deletion_log')
      .insert({ folder_name: f.name, ends_on: f.ends_on, file_count: paths.length });
    if (lErr) console.error('cleanup-folders: log insert failed', f.id, lErr);
    deleted.push(f.name);
  }

  if (dryRun) return json({ dry_run: true, enabled: settings.folder_autodelete_enabled, due: report });
  return json({ deleted: deleted.length, skipped, folders: deleted });
});
