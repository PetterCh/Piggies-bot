const GuildConfig = require('../models/GuildConfig');

const cache = new Map(); // guildId -> { cfg, expires }
const TTL_MS = 60_000;
const DEFAULTS = { adminRoleIds: [], storeChannelId: null, logsChannelId: null, logsEveryone: true, logsMinRarity: 'common' };

/** Configuración del servidor (con caché de 60 s para no consultar la BD en cada comando). */
async function getGuildConfig(guildId) {
  const hit = cache.get(guildId);
  if (hit && hit.expires > Date.now()) return hit.cfg;
  const cfg = { ...DEFAULTS, guildId, ...((await GuildConfig.findOne({ guildId }).lean()) || {}) };
  cache.set(guildId, { cfg, expires: Date.now() + TTL_MS });
  return cfg;
}

/** Aplica operadores de actualización (p. ej. { $set: {...} }) y refresca la caché. */
async function updateGuildConfig(guildId, ops) {
  const body = { ...ops, $setOnInsert: { guildId } };
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  let doc;
  try {
    doc = await GuildConfig.findOneAndUpdate({ guildId }, body, opts).lean();
  } catch (err) {
    if (err.code !== 11000) throw err;
    doc = await GuildConfig.findOneAndUpdate({ guildId }, body, opts).lean();
  }
  const cfg = { ...DEFAULTS, ...doc };
  cache.set(guildId, { cfg, expires: Date.now() + TTL_MS });
  return cfg;
}

module.exports = { getGuildConfig, updateGuildConfig };
