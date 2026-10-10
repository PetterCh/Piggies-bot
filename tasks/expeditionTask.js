const config = require('../config');
const Expedition = require('../models/Expedition');
const { resolveExpedition, notifyResult, recoverStuckExpeditions } = require('../services/expeditions');

/**
 * Revisa cada X segundos las expediciones vencidas y las resuelve.
 * Como el estado vive en MongoDB, las expediciones sobreviven a reinicios del bot.
 */
function start(client) {
  let busy = false;

  recoverStuckExpeditions().catch((e) => console.error('[expediciones] recover:', e));

  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const due = await Expedition.find({ status: 'active', endsAt: { $lte: new Date() } }).select('_id').limit(50);
      for (const { _id } of due) {
        try {
          const res = await resolveExpedition(_id);
          if (res) await notifyResult(client, res.exp, res.outcome);
        } catch (err) {
          console.error('[expediciones] Error resolviendo', _id.toString(), err);
        }
      }
    } catch (err) {
      console.error('[expediciones] ciclo:', err);
    } finally {
      busy = false;
    }
  }, config.expeditions.checkIntervalMs);

  console.log('[tasks] Resolutor de expediciones activo');
}

module.exports = { start };
