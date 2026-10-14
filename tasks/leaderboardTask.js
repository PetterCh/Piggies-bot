const cron = require('node-cron');
const config = require('../config');
const { refreshAll, closeDue } = require('../services/leaderboard');

/** Refresca los paneles cada pocos minutos y cierra la temporada el día 1 de cada mes. */
function start(client) {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await refreshAll(client); } catch (e) { console.error('[leaderboard] ciclo:', e); } finally { busy = false; }
  }, config.leaderboard.refreshMinutes * 60_000);

  cron.schedule(config.leaderboard.seasonCron, () => closeDue(client).catch((e) => console.error('[leaderboard] cron:', e)), { timezone: config.leaderboard.timezone });
  setTimeout(() => closeDue(client).catch((e) => console.error('[leaderboard] arranque:', e)), 30_000); // recupera un cierre perdido
  console.log(`[tasks] Leaderboard: refresco cada ${config.leaderboard.refreshMinutes} min · cierre de temporada "${config.leaderboard.seasonCron}" (${config.leaderboard.timezone})`);
}

module.exports = { start };
