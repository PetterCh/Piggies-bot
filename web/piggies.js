// Módulo WEB de Piggies (independiente del bot): rutas de archivos, metadatos y URL pública.
// No toca MongoDB ni la lógica del juego; solo lee archivos estáticos de la carpeta de la colección.
const fs = require('node:fs');
const path = require('node:path');

// Carpeta de assets. Por defecto ./public/piggies (cámbiala con PIGGIES_DIR, p. ej. a un Volume de Railway: /data/piggies).
const DIR = path.resolve(process.env.PIGGIES_DIR || path.join(__dirname, '..', 'public', 'piggies'));
const ID_RE = /^\d{1,7}$/; // solo números: impide cualquier intento de salirse de la carpeta (../)

/** Normaliza un ID ("0150" -> "150"). Devuelve null si no es válido. */
const normId = (v) => (ID_RE.test(String(v)) ? String(Number(v)) : null);

const metadataPath = (id) => path.join(DIR, 'metadata', `${id}.json`);
const spritePath = (id) => path.join(DIR, 'sprites', `${id}.png`);

/** Lee metadata/<id>.json. null si no existe o está mal formado. */
function readMetadata(v) {
  const id = normId(v);
  if (!id) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metadataPath(id), 'utf8'));
    return meta && typeof meta === 'object' ? meta : null;
  } catch {
    return null;
  }
}

const spriteExists = (v) => { const id = normId(v); return !!id && fs.existsSync(spritePath(id)); };

/** Configuración opcional de la hoja de sprites (sprite-config.json en la carpeta de la colección). */
function readSpriteConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, 'sprite-config.json'), 'utf8')) || {}; } catch { return {}; }
}

/** URL pública del servicio (sin "/" final): PUBLIC_URL, o el dominio que Railway expone en RAILWAY_PUBLIC_DOMAIN. */
function publicBaseUrl() {
  let u = process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  u = u.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

const playUrl = (id) => { const b = publicBaseUrl(); return b ? `${b}/play/${id}` : null; };

module.exports = { DIR, normId, readMetadata, spriteExists, readSpriteConfig, publicBaseUrl, playUrl };
