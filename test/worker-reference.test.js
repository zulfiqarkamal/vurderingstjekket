// Optional read-only audit of the private external reference. Never copy it into Git.
// Set BOLIGLAANSRADAR_REFERENCE to the file path to run these isolated tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const reference = process.env.BOLIGLAANSRADAR_REFERENCE;
const audit = (name, fn) => test(name, { skip: !reference }, fn);
function fixture({ fragment = '<html><body>synthetic</body></html>', upstreamStatus = 200 } = {}) {
  const source = fs.readFileSync(reference, 'utf8');
  const records = new Map();
  const requests = [];
  let writes = 0;
  const env = { STRIPE_SECRET_KEY: 'synthetic-reference-only', STRIPE_WEBHOOK_SECRET: 'synthetic-signing-secret',
    STRIPE_PRICE_MONTHLY: 'price_synthetic_monthly', STRIPE_PRICE_YEARLY: 'price_synthetic_yearly', ADMIN_PASS: 'synthetic-admin',
    HTML_KV: { get: async key => key.startsWith('html_chunk_') ? (key === 'html_chunk_00' ? fragment : '') : records.get(key) || null,
      put: async (key, value) => { writes++; records.set(key, value); }, list: async () => ({ keys: [] }) } };
  const context = vm.createContext({ Request, Response, URL, URLSearchParams, TextEncoder,
    crypto: crypto.webcrypto, atob, fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === 'https://api.stripe.com/v1/checkout/sessions') return Response.json({ id: 'cs_synthetic', url: 'https://checkout.invalid/' });
      if (url.startsWith('https://api.dataforsyningen.dk/adresser/autocomplete')) return new Response('[]', { status: upstreamStatus });
      throw new Error('Unexpected external request blocked');
    } });
  vm.runInContext(source.replace('export default {', 'globalThis.worker = {'), context, { filename: 'private-worker-reference' });
  const request = (route, body, headers = {}) => context.worker.fetch(new Request('https://mortgage.example.invalid' + route,
    body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), env, {});
  const event = (payload, timestamp = Math.floor(Date.now() / 1000)) => {
    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
    return request('/api/webhook/stripe', payload, { 'stripe-signature': `t=${timestamp},v1=${signature}` });
  };
  const completion = extra => ({ type: 'checkout.session.completed', data: { object: {
    id: 'cs_synthetic', customer_email: 'audit@example.invalid', metadata: { plan: 'aarlig' },
    subscription: 'sub_synthetic', payment_status: 'paid', mode: 'subscription', ...extra,
  } } });
  return { request, event, completion, requests, records, context, get writes() { return writes; } };
}

audit('Worker monthly/yearly checkout uses its own origin, prices and subscription mode', async () => {
  for (const plan of ['maaned', 'aarlig']) {
    const f = fixture();
    assert.equal((await f.request('/api/create-checkout-session', { email: 'audit@example.invalid', plan })).status, 200);
    const params = new URLSearchParams(f.requests[0].options.body);
    assert.equal(params.get('mode'), 'subscription');
    assert.equal(params.get('line_items[0][price]'), plan === 'aarlig' ? 'price_synthetic_yearly' : 'price_synthetic_monthly');
    assert.equal(params.get('success_url'), 'https://mortgage.example.invalid/?payment=success&session_id={CHECKOUT_SESSION_ID}');
    assert.equal(params.get('cancel_url'), 'https://mortgage.example.invalid/?payment=cancelled');
    assert.equal(params.get('subscription_data[metadata][email]'), null);
  }
});

audit('Worker rejects invalid webhook signatures and accepts a real locally signed event', async () => {
  const f = fixture();
  assert.equal((await f.request('/api/webhook/stripe', f.completion(), { 'stripe-signature': 'invalid' })).status, 400);
  assert.equal(f.writes, 0);
  assert.equal((await f.event(f.completion())).status, 200);
  assert.equal(JSON.parse([...f.records.values()][0]).status, 'active');
});

audit('AUDIT FINDING: Worker accepts stale signed unpaid completion and repeats writes', async () => {
  const f = fixture();
  const event = f.completion({ payment_status: 'unpaid', mode: 'payment', currency: 'usd', amount_total: 1 });
  assert.equal((await f.event(event, 1)).status, 200);
  assert.equal(JSON.parse([...f.records.values()][0]).status, 'active');
  await f.event(event, 1);
  assert.equal(f.writes, 2);
});

audit('AUDIT FINDING: subscription deletion without email metadata leaves active record', async () => {
  const f = fixture();
  await f.event(f.completion());
  await f.event({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_synthetic', metadata: {} } } });
  assert.equal(JSON.parse([...f.records.values()][0]).status, 'active');
  await f.event({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_synthetic', metadata: { email: 'audit@example.invalid' } } } });
  assert.equal(JSON.parse([...f.records.values()][0]).status, 'cancelled');
});

audit('AUDIT FINDING: public subscribe updates an active customer record without ownership', async () => {
  const f = fixture();
  await f.event(f.completion());
  await f.request('/api/subscribe', { email: 'audit@example.invalid', plan: 'changed', adresse: 'Synthetic address', restgaeld: '123' });
  const record = JSON.parse([...f.records.values()][0]);
  assert.equal(record.status, 'active');
  assert.equal(record.plan, 'changed');
  assert.equal(record.adresse, 'Synthetic address');
});

audit('AUDIT FINDING: email normalization collides and unknown API routes return HTML', async () => {
  const f = fixture();
  await f.request('/api/subscribe', { email: 'audit+one@example.invalid', adresse: 'First synthetic address' });
  await f.request('/api/subscribe', { email: 'audit.one@example.invalid', adresse: 'Second synthetic address' });
  assert.equal(f.records.size, 1);
  assert.equal(JSON.parse([...f.records.values()][0]).email, 'audit.one@example.invalid');
  const wrongWebhook = await f.request('/api/stripe-webhook', {});
  assert.equal(wrongWebhook.status, 200);
  assert.match(wrongWebhook.headers.get('content-type'), /text\/html/);
});

audit('Worker address proxy preserves query; AUDIT FINDING: masks upstream failure status', async () => {
  const f = fixture({ upstreamStatus: 503 });
  const response = await f.request('/api/dawa?q=synthetic&per_side=8');
  assert.equal(f.requests[0].url, 'https://api.dataforsyningen.dk/adresser/autocomplete?q=synthetic&per_side=8');
  assert.equal(response.status, 200);
});

audit('AUDIT FINDING: supplied frontend fragment prevents Stripe injection', async () => {
  const fragment = fs.readFileSync(new URL('../Boliglansradar_Integration_Inputs/boliglansradar-frontend-fragment.html', import.meta.url), 'utf8');
  const response = await fixture({ fragment }).request('/');
  const html = await response.text();
  assert.equal(fragment.includes('</body>'), false);
  assert.equal(html.includes('/api/create-checkout-session'), false);
  assert.match(html, /function payCard\(\)/);
  const wrapped = await (await fixture().request('/')).text();
  assert.ok(wrapped.includes('/api/create-checkout-session'));
});

audit('AUDIT FINDING: injected annual-plan detection does not match supplied controls', async () => {
  const f = fixture();
  const injected = await (await f.request('/')).text();
  const script = injected.match(/<script>([\s\S]*?)<\/script>/)[1];
  let submitted;
  const button = { disabled: false, textContent: '' };
  const window = { location: {} };
  vm.runInNewContext(script, { URLSearchParams, location: { search: '' }, window,
    document: { getElementById: () => null, querySelector: selector => {
      if (selector === 'input[type="email"]') return { value: 'audit@example.invalid' };
      if (selector.includes('payCard')) return button;
      // The fragment uses #btnAarlig.active and selectedPlan, not these selectors.
      return null;
    } }, fetch: async (_url, options) => { submitted = JSON.parse(options.body); return { json: async () => ({ url: 'https://checkout.invalid' }) }; },
    alert() {}, selectedPlan: 'aarlig' });
  await window.payCard();
  assert.equal(submitted.plan, 'maaned');
});
