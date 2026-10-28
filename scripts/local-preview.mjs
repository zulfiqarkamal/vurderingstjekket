// Local-only launcher. Production server.js and public files remain unchanged.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export function createLocalPreview() {
  const app = express();
  const calls = { address: 0, bbr: 0, checkout: 0, blockedNetwork: 0 };
  app.use((req, res, next) => {
    res.set('X-Local-Preview', 'mock-services');
    // Enforce local-only browser connections, even with a forged Host header.
    if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) return res.sendStatus(403);
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'self'; frame-src 'none'");
    const send = res.send.bind(res);
    res.send = body => send(typeof body === 'string' && body.includes('<body>')
      ? body.replace('<body>', '<body><div style="padding:12px;background:#fff2c7;color:#173e35;text-align:center;font:14px system-ui">LOKAL DEMO · Kun fiktive data · Ingen rigtige betalinger eller eksterne API-kald</div>') : body);
    const sendFile = res.sendFile.bind(res);
    res.sendFile = (file, ...args) => {
      if (file.startsWith(path.join(root, 'public') + path.sep) && file.endsWith('.html')) {
        return res.type('html').send(fs.readFileSync(file, 'utf8'));
      }
      return sendFile(file, ...args);
    };
    next();
  });
  app.get('/api/adresse', (req, res) => {
    calls.address++;
    res.json({ suggestions: String(req.query.q || '').length < 3 ? [] : [{
      label: 'Demovej 10, 2635 Demoby', postnr: '2635', by: 'Demoby',
      adresseId: 'local-address', husnummerId: 'local-building', kommunekode: '0183',
    }] });
  });
  app.get('/api/bbr', (_req, res) => {
    calls.bbr++;
    res.json({ found: true, m2: 120, anvKode: '120', boligtypeLabel: 'Enfamiliehus (demo)',
      isEnfamilie: true, isEjerlejlighed: false, landsdel: '011', landsdelnavn: 'Demo',
      kommunekode: '0183', opfoeretAar: 1985 });
  });
  app.get('/__preview/checkout', (_req, res) => res.type('html').send('<!doctype html><html lang="da"><head><meta charset="utf-8"><title>Lokal betalingstest</title></head><body><h1>Simuleret checkout</h1><p>Ingen betaling er oprettet hos Stripe. Dette er kun en lokal demonstration.</p><a href="/ejendomsvurdering?cancelled=1">Test annulleret betaling</a><p><a href="/">Til forsiden</a></p></body></html>'));
  app.use(['/admin', '/test', '/api/test-klage'], (_req, res) => res.sendStatus(404));

  class MockStripe {
    static createFetchHttpClient() { return {}; }
    checkout = { sessions: { create: async () => {
      calls.checkout++;
      return { id: 'cs_local_demo', url: '/__preview/checkout' };
    } } };
    webhooks = { constructEvent() { throw new Error('Webhooks disabled in local preview'); } };
  }
  const localExpress = Object.assign(() => app, { static: express.static, raw: express.raw, json: express.json });
  const context = vm.createContext({
    express: localExpress, Stripe: MockStripe, path, fileURLToPath, crypto,
    // Only HTML existence checks are allowed; no customer/cache files are read.
    fs: { existsSync: file => /\.html$/.test(file) && fs.existsSync(file), writeFileSync() {} },
    process: { env: { NODE_ENV: 'development', STRIPE_SECRET_KEY: 'synthetic-local-only',
      STRIPE_WEBHOOK_SECRET: 'synthetic-local-only', ADMIN_KEY: 'synthetic-disabled-admin',
      BBR_USER: 'synthetic', BBR_PASS: 'synthetic', PRICE_DKK: '350' } },
    URL, URLSearchParams, AbortController, AbortSignal, Buffer, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => { calls.blockedNetwork++; throw new Error('External network disabled in local preview'); },
  });
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('fileURLToPath(import.meta.url)', JSON.stringify(path.join(root, 'server.js')))
    .replace(/app\.listen\(PORT,[^\n]+/, '// Listener managed by the loopback-only preview launcher.');
  vm.runInContext(source, context, { filename: 'server.js' });
  vm.runInContext(`
    getEJEN77Avg2020_2022 = async () => ({ krPerM2: 15000 });
    getSoldComps = async () => [];
    getPrisindeks = async () => ({});
    getAdresseKoordinater = async () => null;
    sendKlageMail = async () => true;
  `, context);
  return { app, calls };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app } = createLocalPreview();
  app.listen(3000, '127.0.0.1', () => console.log('Mock-services preview: http://localhost:3000 (loopback only)'));
}
