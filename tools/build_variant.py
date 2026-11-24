# usage: build_variant.py <testing|testinglive> <src tree> <repo root of main (worktree)> <out dir> <short sha>
# testing     = test database, localStorage prefix tst:, cache stundenzettel-exp-tst-<sha>
# testinglive = the same build on the LIVE database, localStorage prefix tl:, cache stundenzettel-exp-tst-live-<sha>
# Cache names must start with stundenzettel-exp- (the live app deletes every other cache) and with
# stundenzettel-exp-tst- (the old /experimental/ deletes the rest of exp-); testing skips the -live- ones.
import sys, os, shutil
variant, src, main, out, sha = sys.argv[1:6]
assert variant in ('testing', 'testinglive')
live = variant == 'testinglive'
SKIP = {'.gitignore', 'README.md', 'experimental', 'testing', 'testinglive', 'supabase', 'supabase_schema.sql', 'tests', 'CNAME', 'CLAUDE.md', '.claude', '.graphifyignore', 'graphify-out', 'tools'}
if live:
    cfg = open(os.path.join(main, 'js/supabase-config.js'), encoding='utf-8').read()
    assert 'jbrvghmkftvnkjmyoigv' in cfg, 'live config expected'
else:
    cfg = open(os.path.join(main, 'testing/js/supabase-config.js'), encoding='utf-8').read()
    assert 'bdbjimmmksjyqmvopklk' in cfg, 'testing config expected'
logo = open(os.path.join(main, 'testing/js/logo.js'), encoding='utf-8').read()
name = 'LÜBBERT TESTING LIVE' if live else 'LÜBBERT TESTING'
color = '#dc2626' if live else '#7c3aed'
prefix = 'tl:' if live else 'tst:'
banner = ('TESTING LIVE – echte Daten: alles, was du hier speicherst, ist echt' if live
          else 'TESTDATENBANK – testing (keine echten Daten)')
cache_prefix = 'stundenzettel-exp-tst-live-' if live else 'stundenzettel-exp-tst-'
old_filter = ("      const oldCaches = keys.filter(k => k !== CACHE && k.startsWith('stundenzettel-exp-tst-live-') && k !== MEDIA_CACHE);" if live else
              "      const oldCaches = keys.filter(k => k !== CACHE && k.startsWith('stundenzettel-exp-tst-') && !k.startsWith('stundenzettel-exp-tst-live-') && k !== MEDIA_CACHE);")

if os.path.exists(out): shutil.rmtree(out)
os.makedirs(out)
for n in os.listdir(src):
    if n in SKIP or n == '.git': continue
    p = os.path.join(src, n)
    (shutil.copytree if os.path.isdir(p) else shutil.copy2)(p, os.path.join(out, n))

ix = open(os.path.join(out, 'index.html'), encoding='utf-8').read().split('\n')
i = next(k for k, l in enumerate(ix) if '<title>' in l)
ix[i:i + 1] = ['  <title>%s</title>' % name, '  <script>window.IS_TEST_BUILD = true;</script>',
  "  <script>(function(){var P='%s',S=Storage.prototype,g=S.getItem,s=S.setItem,r=S.removeItem;S.getItem=function(k){return g.call(this,P+k)};S.setItem=function(k,v){return s.call(this,P+k,v)};S.removeItem=function(k){return r.call(this,P+k)};})();</script>" % prefix]
b = next(k for k, l in enumerate(ix) if l.strip() == '<body>')
ix[b + 1:b + 1] = [
  '  <div style="position:fixed; left:0; right:0; top:0; padding-top:env(safe-area-inset-top); z-index:99999; background:%s; color:#fff; font:600 11px/1.6 system-ui,sans-serif; text-align:center; pointer-events:none;">%s</div>' % (color, banner),
  '  <style>body{box-sizing:border-box;padding-top:calc(18px + env(safe-area-inset-top))}</style>']
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write('\n'.join(ix))
open(os.path.join(out, 'js/supabase-config.js'), 'w', encoding='utf-8').write(cfg)
open(os.path.join(out, 'js/logo.js'), 'w', encoding='utf-8').write(logo)
manifest = open(os.path.join(main, 'testing/manifest.json'), encoding='utf-8').read().replace('LÜBBERT TESTING', name).replace('#7c3aed', color)
open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8').write(manifest)
sw = open(os.path.join(out, 'sw.js'), encoding='utf-8').read().split('\n')
sw[0] = "const CACHE = '%s%s';" % (cache_prefix, sha)
k = next(k for k, l in enumerate(sw) if 'oldCaches' in l and 'filter' in l)
sw[k] = old_filter
open(os.path.join(out, 'sw.js'), 'w', encoding='utf-8').write('\n'.join(sw))
print('built', variant, out)
