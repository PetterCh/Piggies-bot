// GIFs / WEBP animados para los eventos. Se configuran en data/media.json (sin tocar código):
//   "lootbox.legendary": ["https://.../epico.gif", "assets/lootbox/legendary.webp"]
// - URL http(s): se usa directamente en el embed.
// - Ruta "assets/...": el archivo local se adjunta al mensaje.
// Se prueban las claves en orden (de la más específica a la más general); si no hay nada, el embed sale sin imagen.
const fs = require('node:fs');
const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');
const { pickRandom } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const FILE = path.join(ROOT, 'data', 'media.json');

let cache = { mtime: 0, data: {} };
function load() {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (mtime !== cache.mtime) cache = { mtime, data: JSON.parse(fs.readFileSync(FILE, 'utf8')) }; // recarga en caliente
  } catch (e) {
    console.warn('[media] No pude leer data/media.json:', e.message);
  }
  return cache.data;
}

// "expedition.start.bosque" y "expedicion.start.bosque" son equivalentes (el prefijo canónico es "expedition.").
const alias = (k) => (k.startsWith('expedition.') ? `expedicion.${k.slice(11)}` : k.startsWith('expedicion.') ? `expedition.${k.slice(11)}` : null);

function pick(keys) {
  const data = load();
  for (const key of [].concat(keys)) {
    for (const k of [key, alias(key)]) {
      const arr = k && data[k];
      if (Array.isArray(arr) && arr.length) return pickRandom(arr);
    }
  }
  return null;
}

/**
 * Aplica una imagen/GIF al embed. Devuelve { files } para incluir en el mensaje:
 *   const { files } = withMedia(embed, ['lootbox.epic']);  channel.send({ embeds: [embed], files })
 */
function withMedia(embed, keys) {
  const m = pick(keys);
  if (!m) return { files: [] };
  if (/^https?:\/\//i.test(m)) {
    embed.setImage(m);
    return { files: [] };
  }
  const abs = path.resolve(ROOT, m);
  if (!abs.startsWith(ASSETS + path.sep) || !fs.existsSync(abs)) {
    console.warn(`[media] Archivo local no válido o inexistente (debe estar dentro de /assets): ${m}`);
    return { files: [] };
  }
  const name = path.basename(abs).replace(/[^\w.-]/g, '_');
  embed.setImage(`attachment://${name}`);
  return { files: [new AttachmentBuilder(abs, { name })] };
}

module.exports = { withMedia, pickMedia: pick };
