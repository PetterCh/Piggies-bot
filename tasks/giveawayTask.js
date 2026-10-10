const config = require('../config');
const Giveaway = require('../models/Giveaway');
const { endGiveaway, recoverStuck } = require('../services/giveaways');

/** Cierra los sorteos vencidos (el estado vive en MongoDB, así que sobreviven a reinicios). */
function start(client) {
  let busy = false;
  recoverStuck(client).catch((e) => console.error('[sorteo] recover:', e));

  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const due = await Giveaway.find({ status: 'active', endsAt: { $lte: new Date() } }).select('_id').limit(20);
      for (const { _id } of due) await endGiveaway(client, _id).catch((e) => console.error('[sorteo] error cerrando', _id.toString(), e));
    } catch (e) {
      console.error('[sorteo] ciclo:', e);
    } finally {
      busy = false;
    }
  }, config.giveaways.checkIntervalMs);
  console.log('[tasks] Cierre automático de sorteos activo');
}

module.exports = { start };
