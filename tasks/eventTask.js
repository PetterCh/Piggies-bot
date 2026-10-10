const config = require('../config');
const { tick } = require('../services/events');

/** Cada minuto revisa si toca cerrar un evento o lanzar uno sorpresa. El estado vive en MongoDB (sobrevive a reinicios). */
function start(client) {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await tick(client); } catch (e) { console.error('[eventos] ciclo:', e); } finally { busy = false; }
  }, config.events.checkIntervalMs);
  console.log('[tasks] Eventos globales sorpresa activos');
}

module.exports = { start };
