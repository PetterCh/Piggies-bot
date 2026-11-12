// Servidor Express del módulo web de Piggies. Se arranca desde index.js dentro de un try/catch: si falla, el bot sigue normal.
//  - /piggies/metadata/<id>.json y /piggies/sprites/<id>.png  -> archivos estáticos de la colección (carpeta DIR)
//  - /play/<id>                                               -> vista interactiva (routes/webview.js)
//  - /health                                                  -> 200 "ok" (para el healthcheck de Railway)
const path = require('node:path');
const express = require('express');
const { DIR } = require('./piggies');

function startWebServer() {
  if (['off', 'false', '0', 'no'].includes(String(process.env.WEB_ENABLED || 'on').toLowerCase())) {
    console.log('[web] desactivado (WEB_ENABLED=off)');
    return null;
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Railway está detrás de un proxy (https, IP real)

  app.get(['/', '/health'], (req, res) => res.type('text').send('ok'));

  app.use('/piggies', express.static(DIR, {
    dotfiles: 'ignore', index: false, redirect: false, maxAge: '1h',
    setHeaders: (res) => { res.set('Access-Control-Allow-Origin', '*'); res.set('X-Content-Type-Options', 'nosniff'); },
  }));
  app.use(require('../routes/webview'));

  // Panel Arcade (/arcade): desactívalo con ARCADE_ENABLED=off. Estáticos en public/arcade (HTML, JS, CSS y sprites/).
  if (!['off', 'false', '0', 'no'].includes(String(process.env.ARCADE_ENABLED || 'on').toLowerCase())) {
    app.use(require('../routes/arcade'));
    app.use('/arcade', (req, res, next) => {
      res.set({ 'Content-Security-Policy': "default-src 'none'; img-src 'self' data: https://cdn.discordapp.com; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      next();
    });
    app.use('/arcade', express.static(path.join(__dirname, '..', 'public', 'arcade'), { dotfiles: 'ignore', redirect: true, maxAge: '5m' }));
    const arcade = require('./arcade/service');
    setTimeout(() => arcade.reconcile().catch((e) => console.error('[arcade] reconcile:', e.message)), 20_000);
    setInterval(() => arcade.reconcile().catch((e) => console.error('[arcade] reconcile:', e.message)), 5 * 60_000).unref();
  }
  app.use((req, res) => res.status(404).type('text').send('Not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => { console.error('[web]', err.message); res.status(500).type('text').send('Error'); });

  const port = Number(process.env.PORT) || 3000; // Railway define PORT
  const server = app.listen(port, '0.0.0.0', () => console.log(`🌐 Web de Piggies en el puerto ${port} (assets: ${DIR})`));
  server.on('error', (e) => console.error('[web] no se pudo abrir el puerto:', e.message));
  return server;
}

module.exports = { startWebServer };
