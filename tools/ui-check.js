// UI check without a server or database: serves the repo, fakes Supabase with tools/ui-fixtures.js, logs in a role.
// Made to keep image tokens low: text and layout checks first, a cropped small screenshot only when the look matters.
//
//   node tools/ui-check.js <role> <step> [<step> …] [--shot=<sel>] [--out=dir] [--width=390] [--dark]
//
// step:   heute | <module>[:view] (selectMode) | "js=<name>|<code>" (run code, e.g. "js=ich|navGo('ich')")
// output: per step one line of facts as text: active tab, title, visible text of the main area (shortened),
//         elements wider than the screen, page errors. No image unless --shot is given.
// --shot=<css selector> crops a screenshot of that element per step (1x pixels, at most 800 px high) to --out.
//         Rough cost when the picture is looked at: width x height / 750 tokens (a 390 x 300 card ≈ 160).
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2), opt = {}, steps = [];
args.forEach(a => { const m = /^--([a-z]+)(?:=(.*))?$/.exec(a); if (m) opt[m[1]] = m[2] === undefined ? true : m[2]; else steps.push(a); });
const ROLE = steps.shift() || 'MA', OUT = opt.out || path.join(require('os').tmpdir(), 'ui-check'), W = +(opt.width || 390);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(0);
const DATA = require('./ui-fixtures.js');

(async () => {
  if (opt.shot) fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'block', colorScheme: opt.dark ? 'dark' : 'light' });
  const pg = await ctx.newPage(); let errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  const V = (fs.readFileSync(path.join(ROOT, 'js/changelog.js'), 'utf8').match(/version: *'([^']+)'/) || [])[1] || '';
  await pg.addInitScript(v => { try { localStorage.setItem('luebbert_changelog_seen', v); } catch (e) {} }, V);
  await pg.route(/supabase\.co|googleapis|gstatic/, r => r.abort());
  await pg.goto('http://localhost:' + srv.address().port + '/index.html'); await pg.waitForTimeout(600);
  await pg.evaluate(([DATA, ROLE]) => {
    const q = (t) => { const rows = DATA[t] || []; let one = false;
      const o = new Proxy({}, { get(_, k) {
        if (k === 'then') return (f, g) => Promise.resolve({ data: one ? (rows[0] || null) : rows, error: null, count: rows.length }).then(f, g);
        if (k === 'single' || k === 'maybeSingle') return () => { one = true; return o; };
        return () => o; } }); return o; };
    supabaseClient.from = q; supabaseClient.rpc = () => q('__rpc');
    supabaseClient.channel = () => { const c = { on: () => c, subscribe: () => c, unsubscribe() {} }; return c; };
    supabaseClient.removeChannel = () => {};
    supabaseClient.storage.from = () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'about:blank' } }), list: async () => ({ data: [] }) });
    currentUser = { id: 'u1', full_name: 'Max Muster', role: ROLE }; userRole = ROLE;
    document.getElementById('auth-overlay').style.display = 'none';
    if (typeof navPaint === 'function') navPaint();
  }, [DATA, ROLE]);
  for (const s of steps) {
    errs = [];
    let name = s;
    if (s.startsWith('js=')) { const i = s.indexOf('|'); name = s.slice(3, i); await pg.evaluate(s.slice(i + 1)).catch(e => errs.push(e.message)); }
    else { const [m, v] = s.split(':'); await pg.evaluate(([m, v]) => m === 'heute' ? exitToMenu() : selectMode(m, v), [m, v]).catch(e => errs.push(e.message)); }
    await pg.waitForTimeout(700);
    const facts = await pg.evaluate(() => {
      const vis = el => el && el.offsetParent !== null;
      const page = [...document.querySelectorAll('.page.active, .sig-modal.open, #ui-menu-modal.open')].filter(vis).pop() || document.body;
      const wide = [...document.querySelectorAll('body *')].filter(e => vis(e) && e.getBoundingClientRect().right > innerWidth + 1)
        .slice(0, 5).map(e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]));
      return { tab: (document.querySelector('.w-tab.on span') || {}).textContent || '-', title: (document.getElementById('topbar-title') || {}).textContent || '',
        text: (page.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400), wide };
    });
    console.log('[' + name + '] tab=' + facts.tab + ' title="' + facts.title + '"' + (facts.wide.length ? ' TOO-WIDE=' + facts.wide.join(',') : '') +
      (errs.length ? ' ERRORS=' + JSON.stringify([...new Set(errs)].slice(0, 3)) : '') + '\n  ' + facts.text);
    if (opt.shot) {
      const el = await pg.$(opt.shot), box = el && await el.boundingBox();
      if (!box) { console.log('  (no visible ' + opt.shot + ')'); continue; }
      const file = path.join(OUT, name.replace(/[^\w-]+/g, '_') + '.png');
      await pg.screenshot({ path: file, clip: { x: box.x, y: box.y, width: Math.min(box.width, W), height: Math.min(box.height, 800) } });
      console.log('  shot ' + file + ' (' + Math.round(Math.min(box.width, W)) + 'x' + Math.round(Math.min(box.height, 800)) + ' ≈ ' +
        Math.round(Math.min(box.width, W) * Math.min(box.height, 800) / 750) + ' tokens)');
    }
  }
  await b.close(); srv.close();
})();
