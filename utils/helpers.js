// Utilidades genéricas sin dependencias del bot.

/** Error "esperado" cuyo mensaje se puede mostrar tal cual al usuario. */
class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Fisher-Yates (muta y devuelve el mismo array). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Como Promise.all(items.map(fn)) pero con máximo `limit` tareas simultáneas. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

/** "90s", "15m", "2h", "1d", "1h30m" -> milisegundos (null si el formato es inválido). */
function parseDuration(str) {
  const text = String(str || '').trim();
  if (!/^(\d+\s*[smhdw]\s*)+$/i.test(text)) return null;
  const mult = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 };
  let ms = 0;
  for (const m of text.matchAll(/(\d+)\s*([smhdw])/gi)) ms += Number(m[1]) * mult[m[2].toLowerCase()];
  return ms || null;
}

/** "2026-10-12 18:30" (UTC) -> Date, o null si no es una fecha válida. */
function parseUtc(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && h < 24 && mi < 60 ? date : null;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const fmt = (n) => Number(n).toLocaleString('en-US');

const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

module.exports = { parseDuration, parseUtc, UserError, sleep, randInt, pickRandom, shuffle, mapLimit, escapeRegex, fmt, shortAddr };
