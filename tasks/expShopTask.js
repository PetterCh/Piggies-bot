const config = require('../config');
const { tick } = require('../services/expShop');

/** Cada minuto comprueba si cambió la franja de rotación y, si es así, publica el nuevo escaparate. */
function start(client) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await tick(client); } catch (e) { console.error('[tienda-exp] ciclo:', e); } finally { busy = false; }
  };
  setTimeout(run, 10_000); // al arrancar, repone el escaparate si el bot estuvo apagado en un cambio de franja
  setInterval(run, config.expShop.checkIntervalMs);
  console.log(`[tasks] Tienda de expedición rotativa activa (cada ${config.expShop.rotationHours} h)`);
}

module.exports = { start };
