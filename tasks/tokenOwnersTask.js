const cron = require('node-cron');
const config = require('../config');
const { autoRefresh } = require('../services/tokenOwners');

/**
 * Mantiene al día el índice interno de Token IDs (roles 1/1) SIN intervención del admin:
 *  - 1 minuto después de arrancar (así la primera carga se hace sola),
 *  - y una vez al día (TOKEN_OWNERS_CRON, por defecto 02:30; la sincronización de roles va a las 03:00).
 * Es lento a propósito (1 lectura cada 0,4 s) y nunca bloquea ni se mezcla con la sincronización de roles.
 */
function start(client) {
  if (!config.nft.tokenOwners.auto) return console.log('[tasks] Índice de Token IDs automático: desactivado (TOKEN_OWNERS_AUTO=off)');
  setTimeout(() => autoRefresh(client).catch((e) => console.error('[nft] arranque índice:', e)), 60_000);
  cron.schedule(config.nft.tokenOwners.cron, () => autoRefresh(client, { maxAgeHours: 20 }).catch((e) => console.error('[nft] cron índice:', e)), { timezone: config.nft.timezone });
  console.log(`[tasks] Índice de Token IDs: primera carga en 1 min y "${config.nft.tokenOwners.cron}" (${config.nft.timezone})`);
}

module.exports = { start };
