// Ruta web independiente: GET /play/:id  (vista interactiva del Piggie). No usa MongoDB ni el cliente de Discord.
const crypto = require('node:crypto');
const express = require('express');
const { normId, readMetadata, readSpriteConfig } = require('../web/piggies');
const { renderPlayPage } = require('../web/playPage');

const notFound = (res, text) => res.status(404).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#1b1626;color:#f3e9ff;display:grid;place-items:center;height:100vh;margin:0"><p>🐷 ${text}</p></body>`);

function handlePlay(req, res) {
  const id = normId(req.params.id);
  const meta = id && readMetadata(id);
  if (!meta) return notFound(res, 'Piggie not found');

  const nonce = crypto.randomBytes(16).toString('base64');
  const sprite = { ...readSpriteConfig(), ...(meta.sprite && typeof meta.sprite === 'object' ? meta.sprite : {}) };
  res.set({
    'Content-Security-Policy': `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache',
  });
  return res.status(200).type('html').send(renderPlayPage({ id, meta, sprite, nonce }));
}

const router = express.Router();
router.get('/play/:id', handlePlay);

module.exports = router;
module.exports.handlePlay = handlePlay;
