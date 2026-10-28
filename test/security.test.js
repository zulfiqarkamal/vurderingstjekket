import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run the real route handlers without installing packages, opening sockets,
// reading customer storage, writing files, or allowing external requests.
function fixture(extraEnv = {}) {
  const routes = new Map();
  const app = { use() {}, get(p, fn) { routes.set('GET ' + p, fn); },
    post(p, fn) { routes.set('POST ' + p, fn); }, listen() {} };
  let staticOptions;
  const express = Object.assign(() => app, { raw() {}, json() {}, static(_directory, options) { staticOptions = options; } });
  let emails = 0;
  let generations = 0;
  let checkoutOptions;
  class Stripe {
    static createFetchHttpClient() { return {}; }
    checkout = { sessions: { create: async options => {
      checkoutOptions = options;
      return { id: 'cs_test_order', url: 'https://checkout.invalid' };
    } } };
    webhooks = { constructEvent(body, signature) {
      if (signature !== 'test-signature') throw new Error('Invalid signature');
      return body;
    } };
  }
  const context = vm.createContext({ express, Stripe, path, fileURLToPath, crypto,
    fs: { existsSync: file => /[\\/]public[\\/]index\.html$/.test(file), writeFileSync() { throw new Error('Disk writes prohibited'); } },
    process: { env: { STRIPE_SECRET_KEY: 'synthetic-test-key', STRIPE_WEBHOOK_SECRET: 'synthetic-test-secret', ADMIN_KEY: 'synthetic-test-admin', NODE_ENV: 'production', ...extraEnv } },
    console: { log() {}, warn() {}, error() {} }, URL, URLSearchParams, AbortController, AbortSignal,
    setTimeout, clearTimeout, Buffer,
    fetch: async () => { throw new Error('Network prohibited'); },
    mockMail: async () => { emails++; return true; },
    mockGenerate: async (_id, sess) => { generations++; sess.status = 'done'; sess.klageTekst = 'Synthetic report'; },
  });
  const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('fileURLToPath(import.meta.url)', "'/offline/server.js'");
  vm.runInContext(source, context, { filename: 'server.js' });
  vm.runInContext('sendKlageMail = mockMail; generateKlage = mockGenerate;', context);
  async function request(method, route, { body = {}, cookie = '', params = {}, signature = '', query = {} } = {}) {
    const req = { body, params, query, headers: { origin: 'https://app.invalid', cookie, 'stripe-signature': signature } };
    const res = { statusCode: 200, headers: {}, status(n) { this.statusCode = n; return this; },
      set(k, v) { this.headers[k.toLowerCase()] = v; return this; },
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      cookie(name, value, options) { this.headers['set-cookie'] = `${name}=${value}`; this.cookieOptions = options; return this; },
      sendFile(file) { this.file = file; return this; },
      redirect(status, target) { this.statusCode = status; this.target = target; return this; },
      json(data) { this.body = data; return this; }, send(data) { this.body = data; return this; } };
    await routes.get(method + ' ' + route)(req, res);
    return res;
  }
  const checkout = body => request('POST', '/api/create-payment', { body: {
    address: 'Synthetic address', postnr: '9999', m2: 120, ev: 3000000, kommunekode: '0101', ...body,
  } });
  const report = (id, cookie) => request('GET', '/api/klage/:sessionId', { params: { sessionId: id }, cookie });
  const mail = (id, cookie) => request('POST', '/api/send-klage-mail', { body: { sessionId: id, email: 'reader@example.invalid' }, cookie });
  const complete = (id, fields = {}, signature = 'test-signature') => request('POST', '/api/stripe-webhook', {
    signature, body: { type: 'checkout.session.completed', data: { object: {
      id: 'cs_test_order', metadata: { sessionId: id }, payment_status: 'paid',
      currency: 'dkk', amount_total: 35000, ...fields,
    } } },
  });
  return { checkout, report, mail, complete, request, get emails() { return emails; }, get generations() { return generations; },
    get checkoutOptions() { return checkoutOptions; },
    get staticOptions() { return staticOptions; },
    hasRoute: key => routes.has(key),
    session: id => vm.runInContext(`SESSIONS.get(${JSON.stringify(id)})`, context) };
}

function ownerCookie(checkout) { return (checkout.headers['set-cookie'] || '').split(';')[0]; }

test('checkout cannot inject internal report or payment fields', async () => {
  const f = fixture();
  const r = await f.checkout({ status: 'done', createdAt: 1, klageTekst: 'Injected', paid: true,
    paymentVerified: true, testAuthorized: true, expectedAmount: 1, accessExpiresAt: Infinity,
    stripeCheckoutId: 'attacker', customerEmail: 'attacker@example.invalid', accessTokenHash: 'attacker' });
  assert.equal(r.statusCode, 200);
  const s = f.session(r.body.sessionId);
  assert.equal(s.status, 'pending_payment');
  assert.notEqual(s.createdAt, 1);
  assert.equal(s.klageTekst, undefined);
  assert.equal(s.paymentVerified, false);
  assert.equal(s.paid, undefined);
  assert.equal(s.customerEmail, undefined);
  assert.equal(s.testAuthorized, undefined);
  assert.equal(s.expectedAmount, 35000);
  assert.notEqual(s.accessTokenHash, 'attacker');
});

test('unpaid owner cannot read or email a report', async () => {
  const f = fixture(); const r = await f.checkout(); const id = r.body.sessionId;
  assert.equal((await f.report(id, ownerCookie(r))).statusCode, 403);
  assert.equal((await f.mail(id, ownerCookie(r))).statusCode, 403);
  assert.equal(f.emails, 0);
});

test('paid report and email require the owning browser cookie', async () => {
  const f = fixture(); const r = await f.checkout(); const id = r.body.sessionId;
  const other = await f.checkout();
  await f.complete(id);
  for (const cookie of ['', 'unrelated=value', ownerCookie(other), ownerCookie(r) + 'tampered']) {
    assert.equal((await f.report(id, cookie)).statusCode, 403);
    assert.equal((await f.mail(id, cookie)).statusCode, 403);
  }
  assert.equal(f.emails, 0);
  assert.equal((await f.report(id, ownerCookie(r))).body.klageTekst, 'Synthetic report');
  assert.equal((await f.mail(id, ownerCookie(r))).statusCode, 200);
  assert.equal(f.emails, 1);
  assert.equal(r.cookieOptions.httpOnly, true);
  assert.equal(r.cookieOptions.secure, true);
  assert.equal(r.cookieOptions.sameSite, 'lax');
  assert.equal(r.cookieOptions.path, '/api');
  assert.equal(r.cookieOptions.maxAge, 86400000);
  assert.equal((await f.report(id, ownerCookie(r))).headers['cache-control'], 'no-store');
});

test('unpaid, mismatched, and unsigned events never authorize reports', async () => {
  for (const fields of [{ payment_status: 'unpaid' }, { id: 'cs_other' }, { currency: 'eur' }, { amount_total: 1 }]) {
    const f = fixture(); const r = await f.checkout();
    await f.complete(r.body.sessionId, fields);
    assert.equal((await f.report(r.body.sessionId, ownerCookie(r))).statusCode, 403);
    assert.equal(f.generations, 0);
  }
  const f = fixture(); const r = await f.checkout();
  assert.equal((await f.complete(r.body.sessionId, {}, 'invalid')).statusCode, 400);
  assert.equal((await f.report(r.body.sessionId, ownerCookie(r))).statusCode, 403);
});

test('repeat payment completion does not fulfill twice', async () => {
  const f = fixture(); const r = await f.checkout();
  await f.complete(r.body.sessionId); await f.complete(r.body.sessionId);
  assert.equal(f.generations, 1);
});

test('invalid checkout inputs are rejected without creating an order', async () => {
  const f = fixture();
  for (const body of [{ m2: -1 }, { m2: '1e999' }, { ev: 0 }, { ev: 'invalid' },
    { m2: '<img src=x>' }, { m2: [120] }, { ev: true }, { address: {} }, { gv: -1 }, { gv: [] }]) {
    assert.equal((await f.checkout(body)).statusCode, 400);
  }
});

test('expired and unknown report access is denied without disclosing report data', async () => {
  const f = fixture(); const r = await f.checkout(); const id = r.body.sessionId;
  await f.complete(id);
  f.session(id).accessExpiresAt = Date.now() - 1;
  for (const target of [id, 'unknown']) {
    const response = await f.report(target, ownerCookie(r));
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.klageTekst, undefined);
    assert.equal((await f.mail(target, ownerCookie(r))).statusCode, 403);
  }
  assert.equal(f.emails, 0);
});

test('admin test reports retain browser-bound access without authorizing public checkout', async () => {
  const f = fixture();
  assert.equal((await f.request('GET', '/api/test-klage')).statusCode, 403);
  const r = await f.request('GET', '/api/test-klage', { query: { key: 'synthetic-test-admin' } });
  assert.equal(r.statusCode, 200);
  assert.equal((await f.report(r.body.sessionId, ownerCookie(r))).statusCode, 200);
  assert.equal((await f.report(r.body.sessionId)).statusCode, 403);
  assert.equal((await f.mail(r.body.sessionId, ownerCookie(r))).statusCode, 200);
});

test('product routes isolate Worker navigation from Railway APIs', async () => {
  const offline = fixture();
  assert.match((await offline.request('GET', '/ejendomsvurdering')).file, /ejendomsvurdering\.html$/);
  const liveEntry = await offline.request('GET', '/boliglaanstjek', { query: { session: 'private-order', email: 'private@example.invalid' } });
  assert.equal(liveEntry.target, 'https://boliglansradar.gamma7th.workers.dev/');
  assert.equal(liveEntry.headers['referrer-policy'], 'no-referrer');
  assert.match((await offline.request('GET', '/boliglaanstjek/preview')).file, /boliglaanstjek-preview\.html$/);
  const worker = fixture({ BOLIGLAANSRADAR_URL: 'https://mortgage.example.invalid' });
  const response = await worker.request('GET', '/boliglaanstjek');
  assert.equal(response.statusCode, 302);
  assert.equal(response.target, 'https://mortgage.example.invalid/');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('invalid Worker configuration cannot become an unsafe redirect', async () => {
  for (const url of ['javascript:alert(1)', 'http://example.invalid', 'https://user:pass@example.invalid', 'https://example.invalid/api', 'https://example.invalid/?token=x', 'broken']) {
    const response = await fixture({ BOLIGLAANSRADAR_URL: url }).request('GET', '/boliglaanstjek');
    assert.match(response.file, /boliglaanstjek-preview\.html$/);
    assert.equal(response.target, undefined);
  }
});

test('historical Stripe callback links retain the query and owning origin', () => {
  const script = readFileSync(new URL('../public/home.js', import.meta.url), 'utf8');
  for (const search of ['', '?session=synthetic-order', '?cancelled=1', '?test=synthetic']) {
    let destination;
    vm.runInNewContext(script, { URLSearchParams, location: { search, hash: '', replace: value => { destination = value; } } });
    assert.equal(destination, search ? '/ejendomsvurdering' + search : undefined);
  }
});

test('frontend scripts compile and product links resolve to local entries', () => {
  for (const file of ['index.html', 'ejendomsvurdering.html', 'boliglaanstjek-preview.html']) {
    const html = readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
    assert.equal((html.match(/<body>/g) || []).length, 1);
    assert.equal((html.match(/<\/body>/g) || []).length, 1);
    for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script);
  }
  const home = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(home, /href="\/ejendomsvurdering"/);
  assert.match(home, /href="\/boliglaanstjek"/);
  const assessment = readFileSync(new URL('../public/ejendomsvurdering.html', import.meta.url), 'utf8');
  assert.match(assessment, /fetch\("\/api\/create-payment"/);
  assert.match(assessment, /history.replaceState\(\{\}, "", "\/ejendomsvurdering"\)/);
});

test('mortgage preview blocks network and preserves basic calculation behaviour', async () => {
  const preview = readFileSync(new URL('../public/boliglaanstjek-preview.html', import.meta.url), 'utf8');
  const calculation = preview.slice(preview.indexOf('const MARKEDSRENTER'), preview.indexOf('// ── Main calculation'));
  const context = vm.createContext({});
  vm.runInContext(calculation, context);
  assert.equal(vm.runInContext('mYdelse(1200000, 0, 10)', context), 10000);
  assert.equal(vm.runInContext('mYdelse(1200000, 4, 30, true)', context), 4000);
  assert.equal(vm.runInContext('bidragssats(60)', context), 0.55);
  assert.equal(vm.runInContext('bidragssats(80)', context), 0.85);
  assert.equal(vm.runInContext('konvOmk(1000000)', context), 20000);
  const window = { addEventListener() {} };
  vm.runInNewContext(readFileSync(new URL('../public/mortgage-preview.js', import.meta.url), 'utf8'), { window });
  await assert.rejects(window.fetch('/api/subscribe'), /afkoblet/);
  await assert.rejects(window.fetch('/api/analyze-screenshot'), /afkoblet/);
  await assert.rejects(window.fetch('/api/dawa'), /afkoblet/);
});

test('new Railway checkouts return directly to the assessment product', async () => {
  const f = fixture();
  const response = await f.checkout();
  assert.equal(response.statusCode, 200);
  assert.equal(f.checkoutOptions.success_url, 'https://app.invalid/ejendomsvurdering?session=' + response.body.sessionId);
  assert.equal(f.checkoutOptions.cancel_url, 'https://app.invalid/ejendomsvurdering?cancelled=1');
  assert.equal(f.checkoutOptions.mode, 'payment');
  assert.equal(f.checkoutOptions.line_items[0].price_data.currency, 'dkk');
  assert.equal(f.checkoutOptions.line_items[0].price_data.unit_amount, 35000);
  assert.ok(response.headers['set-cookie'].startsWith('report_access_' + response.body.sessionId + '='));
  assert.equal(response.cookieOptions.path, '/api');
  assert.equal(response.cookieOptions.httpOnly, true);
});

test('legacy callbacks render assessment on the original origin without JavaScript', async () => {
  const f = fixture();
  for (const query of [{ session: 'synthetic-order' }, { cancelled: '1' }, { test: 'synthetic-admin' }]) {
    const response = await f.request('GET', '/', { query });
    assert.match(response.file, /ejendomsvurdering\.html$/);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.target, undefined);
  }
});

test('normal homepage routing and independent API ownership are preserved', async () => {
  const f = fixture();
  assert.equal(f.staticOptions.index, false);
  for (const query of [{}, { campaign: 'synthetic' }]) {
    const response = await f.request('GET', '/', { query });
    assert.match(response.file, /[\\/]public[\\/]index\.html$/);
    assert.equal(response.headers['cache-control'], 'no-cache');
  }
  assert.equal(f.hasRoute('POST /api/stripe-webhook'), true);
  assert.equal(f.hasRoute('POST /api/create-payment'), true);
  for (const route of ['GET /api/dawa', 'POST /api/analyze-screenshot', 'POST /api/subscribe']) {
    assert.equal(f.hasRoute(route), false, 'Worker API must not be added to Railway: ' + route);
  }
  const preview = await fixture({ BOLIGLAANSRADAR_URL: '' }).request('GET', '/boliglaanstjek');
  assert.match(preview.file, /boliglaanstjek-preview\.html$/);
});
