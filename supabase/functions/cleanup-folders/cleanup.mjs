// Pure helpers of cleanup-folders (no network), tested in cleanup.test.mjs.

// Top-level folders whose deletion date (ends_on) lies before today, each with the ids of its whole subtree.
// Subfolders never count on their own date. Cycle-safe; oldest date first.
export function dueFolderTrees(folders, today) {
  const all = folders || [];
  return all
    .filter(f => !f.parent_id && f.ends_on && f.ends_on < today)
    .sort((a, b) => (a.ends_on < b.ends_on ? -1 : a.ends_on > b.ends_on ? 1 : 0))
    .map(f => {
      const treeIds = [f.id];
      for (let i = 0; i < treeIds.length; i++) {
        for (const c of all) {
          if (c.parent_id === treeIds[i] && !treeIds.includes(c.id)) treeIds.push(c.id);
        }
      }
      return { id: f.id, name: f.name, ends_on: f.ends_on, treeIds };
    });
}

// Storage object paths in bucket project-files from the public file urls (part after "/project-files/").
// Urls of other origins are dropped, duplicates removed.
export function storagePaths(urls) {
  const out = [];
  for (const u of urls || []) {
    const parts = String(u || '').split('/project-files/');
    if (parts.length < 2) continue;
    let p = parts.slice(1).join('/project-files/').split('?')[0];
    try { p = decodeURIComponent(p); } catch { /* keep the raw path */ }
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

export function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
