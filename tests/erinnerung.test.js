// Run from the repo root: node --test tests/erinnerung.test.js
// Loads erinnerung.js into a sandbox with a fake push stack and a fake Supabase client.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SUB = { endpoint: 'https://push.example/abc', keys: { p256dh: 'P', auth: 'A' } };
let ctx, calls;
beforeEach(() => {
  calls = [];
  const reg = { pushManager: { getSubscription: async () => ({ toJSON: () => SUB }) } };
  ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', serviceWorker: { getRegistration: async () => reg, ready: Promise.resolve(reg) } },
    Notification: { permission: 'granted', requestPermission: async () => 'granted' },
    PushManager: function() {},
    VAPID_PUBLIC_KEY: 'AAAA',
    currentUser: { id: 'u-al' },
    supabaseClient: {
      rpc: async (fn, args) => { calls.push({ rpc: fn, args }); return { data: null, error: null }; },
      from: t => { calls.push({ from: t }); throw new Error('direct table access: ' + t); },
    },
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/erinnerung.js'), 'utf8'), ctx, { filename: 'erinnerung.js' });
});
const plain = v => JSON.parse(JSON.stringify(v));
const RPC = { rpc: 'register_push_subscription', args: { p_endpoint: SUB.endpoint, p_p256dh: 'P', p_auth: 'A' } };

test('syncPushSubscription: saves through rpc register_push_subscription, no table upsert', async () => {
  await ctx.syncPushSubscription();
  assert.deepEqual(plain(calls), [RPC]);
});

test('enablePushReminders: saves through rpc register_push_subscription and reports granted', async () => {
  assert.equal(await ctx.enablePushReminders(), 'granted');
  assert.deepEqual(plain(calls), [RPC]);
});

test('enablePushReminders: rpc error → unsupported', async () => {
  ctx.supabaseClient.rpc = async () => ({ data: null, error: { message: 'not logged in' } });
  assert.equal(await ctx.enablePushReminders(), 'unsupported');
});

test('source: no direct upsert into push_subscriptions left', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/erinnerung.js'), 'utf8');
  assert.doesNotMatch(src, /from\('push_subscriptions'\)\s*\.upsert/);
});

test('erPickShift: the plan shift that shares words with the folder name, else the only one of the day', () => {
  const estrel = { venue: 'Estrel', title: 'Business of Apps', location: ['Auditorium'] };
  const messe = { venue: 'Messe Berlin', title: 'Gala Dinner', location: [] };
  assert.equal(ctx.erPickShift([messe, estrel], '261111_Estrel_Business of Apps'), estrel);
  assert.equal(ctx.erPickShift([messe, estrel], '261111 Gala'), messe);
  assert.equal(ctx.erPickShift([messe], 'Ganz anderer Name'), messe);
  assert.equal(ctx.erPickShift([messe, estrel], 'Ganz anderer Name'), null);
  assert.equal(ctx.erPickShift([], 'Estrel'), null);
});
