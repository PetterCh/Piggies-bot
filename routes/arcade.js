// Rutas del Panel Arcade (independientes del resto del bot):
//   GET  /arcade/enter?t=<token firmado>   canjea el enlace de /arcade por una cookie de sesión y redirige a /arcade/
//   *    /api/arcade/...                    API del juego (requiere la cookie; las POST exigen la cabecera X-Arcade: 1)
const express = require('express');
const auth = require('../web/arcade/auth');
const svc = require('../web/arcade/service');

const router = express.Router();

const page = (res, status, es, en) => res.status(status).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arcade</title><body style="font-family:system-ui;background:#1b1626;color:#f3e9ff;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:16px"><p>🐷 ${es}<br><small>${en}</small></p></body>`);

// ---- Canje del enlace ----
const enterLimit = auth.rateLimit({ windowMs: 60_000, max: 20, key: (req) => req.ip });
router.get('/arcade/enter', enterLimit, (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  const link = auth.verify(req.query.t, 'link');
  if (!link) return page(res, 400, 'Enlace inválido o caducado. Usa <b>/arcade</b> otra vez en Discord.', 'Invalid or expired link. Use <b>/arcade</b> again on Discord.');
  const existing = auth.sessionFrom(req);
  if (!auth.markUsed(link.j, link.exp)) {
    if (existing && existing.u === link.u) return res.redirect(302, '/arcade/'); // doble clic con la sesión ya abierta
    return page(res, 400, 'Este enlace ya se usó. Pide uno nuevo con <b>/arcade</b>.', 'This link was already used. Get a new one with <b>/arcade</b>.');
  }
  res.setHeader('Set-Cookie', auth.sessionCookie(auth.createSessionToken(link), req));
  return res.redirect(302, '/arcade/');
});

// ---- API ----
const api = express.Router();
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.use(auth.requireSession);
api.use(auth.rateLimit({ windowMs: 10_000, max: 120, key: (req) => req.arcade.id }));
api.use(auth.csrf);
api.use(express.json({ limit: '2kb' }));

const wrap = (fn) => async (req, res) => {
  try {
    const out = await fn(req);
    const balance = await svc.balanceOf(req.arcade.id);
    res.json({ ok: true, balance, ...out });
  } catch (err) {
    if (err instanceof svc.ArcadeError) return res.status(err.status).json({ error: err.code });
    console.error('[arcade]', err);
    res.status(500).json({ error: 'server' });
  }
};
const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

api.get('/me', async (req, res) => { try { res.json({ ok: true, ...(await svc.me(req.arcade)) }); } catch (e) { console.error('[arcade]', e); res.status(500).json({ error: 'server' }); } });
api.get('/crash/state', wrap((req) => svc.crashState(req.arcade).then((game) => ({ state: game }))));
api.post('/crash/start', wrap((req) => svc.crashStart(req.arcade, Number(body(req).bet)).then((game) => ({ state: game }))));
api.post('/crash/cashout', wrap((req) => svc.crashCashout(req.arcade).then((game) => ({ state: game }))));
api.get('/mines/state', wrap((req) => svc.minesState(req.arcade).then((game) => ({ state: game }))));
api.post('/mines/start', wrap((req) => svc.minesStart(req.arcade, Number(body(req).bet), Number(body(req).bombs)).then((game) => ({ state: game }))));
api.post('/mines/reveal', wrap((req) => svc.minesReveal(req.arcade, Number(body(req).idx)).then((game) => ({ state: game }))));
api.post('/mines/cashout', wrap((req) => svc.minesCashout(req.arcade).then((game) => ({ state: game }))));
api.get('/leaderboard', wrap((req) => svc.leaderboard({ type: req.query.type === 'profit' ? 'profit' : 'mult', range: req.query.range === 'all' ? 'all' : 'month' }).then((rows) => ({ rows }))));

router.use('/api/arcade', api);

module.exports = router;
