const config = require('../config');
const AuditLog = require('../models/AuditLog');

/** Guarda una acción administrativa en la BD (no rompe el comando si falla). */
const audit = (entry) => AuditLog.create(entry).catch((e) => console.error('[audit]', e));

/** Avisa a los admins en el canal de logs configurado (si existe). */
async function notifyAdmins(client, payload) {
  if (!config.logChannelId) return false;
  try {
    const ch = await client.channels.fetch(config.logChannelId);
    await ch.send({ allowedMentions: { parse: [] }, ...payload });
    return true;
  } catch (e) {
    console.error('[adminLog] no pude escribir en el canal de logs:', e.message);
    return false;
  }
}

module.exports = { audit, notifyAdmins };
