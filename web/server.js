// Servidor Express del módulo web de Piggies. Se arranca desde index.js dentro de un try/catch: si falla, el bot sigue normal.
//  - /piggies/metadata/<id>.json y /piggies/sprites/<id>.png  -> archivos estáticos de la colección (carpeta DIR)
//  - /play/<id>                                               -> vista interactiva (routes/webview.js)
//  - /health                                                  -> 200 "ok" (para el healthcheck de Railway)
const express = require('express');
const { DIR } = require('./piggies');

function startWebServer() {
  if (['off', 'false', '0', 'no'].includes(String(process.env.WEB_ENABLED || 'on').toLowerCase())) {
    console.log('[web] desactivado (WEB_ENABLED=off)');
    return null;
  }
  const app = express();
  app.disable('x-powered-by');

  app.get(['/', '/health'], (req, res) => res.type('text').send('ok'));

  app.use('/piggies', express.static(DIR, {
    dotfiles: 'ignore', index: false, redirect: false, maxAge: '1h',
    setHeaders: (res) => { res.set('Access-Control-Allow-Origin', '*'); res.set('X-Content-Type-Options', 'nosniff'); },
  }));
  app.use(require('../routes/webview'));
  app.use((req, res) => res.status(404).type('text').send('Not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => { console.error('[web]', err.message); res.status(500).type('text').send('Error'); });

  const port = Number(process.env.PORT) || 3000; // Railway define PORT
  const server = app.listen(port, '0.0.0.0', () => console.log(`🌐 Web de Piggies en el puerto ${port} (assets: ${DIR})`));
  server.on('error', (e) => console.error('[web] no se pudo abrir el puerto:', e.message));
  return server;
}

module.exports = { startWebServer };
