// Autenticación del Arcade: enlaces temporales FIRMADOS (HMAC-SHA256) + cookie de sesión firmada. Nadie puede cambiar el ID de usuario
// editando la URL: el servidor solo confía en lo que firmó él mismo. El ID de Discord SOLO sale de la firma, nunca de parámetros.
const crypto = require('node:crypto');
const config = require('../../config');

// Secreto: ARCADE_SECRET (recomendado) o, si no existe, un derivado del token del bot (que ya es secreto).
const SECRET = process.env.ARCADE_SECRET || crypto.createHash('sha256').update(`arcade:${config.token || 'dev-only'}`).digest('hex');
const COOKIE = 'arcade_session';
const LINK_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 3 * 3600_000;

const b64 = (b) => Buffer.from(b).toString('base64url');
const mac = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function sign(payload) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${mac(body)}`;
}

/** Devuelve el payload si la firma es válida y no caducó; si no, null. */
function verify(token, kind) {
  if (typeof token !== 'string' || token.length > 1500) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p.k !== kind || typeof p.u !== 'string' || !/^\d{5,25}$/.test(p.u) || !(p.exp > Date.now())) return null;
    return p;
  } catch { return null; }
}

const cleanName = (s) => String(s || 'Piggy').replace(/[\u0000-\u001f<>]/g, '').slice(0, 32) || 'Piggy';
const cleanAvatar = (u) => (typeof u === 'string' && /^https:\/\/cdn\.discordapp\.com\/[\w\-/.?=&]{1,200}$/.test(u) ? u : '');

/** Enlace de un solo uso para /arcade (10 min). */
const createLinkToken = ({ id, name, avatar, guildId }) =>
  sign({ k: 'link', u: String(id), n: cleanName(name), a: cleanAvatar(avatar), g: guildId || null, j: crypto.randomBytes(9).toString('base64url'), exp: Date.now() + LINK_TTL_MS });

const createSessionToken = (link) => sign({ k: 'sess', u: link.u, n: link.n, a: link.a, g: link.g, exp: Date.now() + SESSION_TTL_MS });

// Enlaces ya canjeados (memoria): un enlace robado/reenviado no sirve dos veces.
const used = new Map();
function markUsed(jti, exp) {
  const now = Date.now();
  for (const [k, v] of used) if (v < now) used.delete(k);
  if (used.has(jti)) return false;
  used.set(jti, exp);
  return true;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = (req) => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
const sessionCookie = (token, req) => `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${isHttps(req) ? '; Secure' : ''}`;
const sessionFrom = (req) => verify(parseCookies(req.headers.cookie)[COOKIE], 'sess');

// ---- Middleware ----
function requireSession(req, res, next) {
  const s = sessionFrom(req);
  if (!s) return res.status(401).json({ error: 'auth' });
  req.arcade = { id: s.u, name: s.n, avatar: s.a, guildId: s.g };
  next();
}

/** Anti-CSRF para POST: cabecera propia (un formulario/otro sitio no puede ponerla sin CORS) + el Origin, si viene, debe ser este mismo host. */
function csrf(req, res, next) {
  if (req.method === 'GET') return next();
  const origin = req.headers.origin;
  let sameOrigin = true;
  if (origin) { try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; } }
  if (req.headers['x-arcade'] !== '1' || !sameOrigin) return res.status(403).json({ error: 'csrf' });
  next();
}

/** Límite de peticiones en memoria: `max` por `windowMs` y clave. */
function rateLimit({ windowMs, max, key }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(k, arr);
    if (hits.size > 5000) for (const [kk, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(kk);
    if (arr.length > max) return res.status(429).json({ error: 'rate' });
    next();
  };
}

module.exports = { COOKIE, createLinkToken, createSessionToken, verify, markUsed, sessionCookie, sessionFrom, requireSession, csrf, rateLimit, cleanName };
