const config = require('../config');
const { tick } = require('../services/expShop');

/** Cada minuto comprueba si cambió la franja de cada nivel (12 h / 24 h) y, si es así, publica el nuevo escaparate. */
function start(client) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await tick(client); } catch (e) { console.error('[tienda-exp] ciclo:', e); } finally { busy = false; }
  };
  setTimeout(run, 10_000); // al arrancar, repone el escaparate si el bot estuvo apagado en un cambio de franja
  setInterval(run, config.expShop.checkIntervalMs);
  console.log(`[tasks] Tienda de expedición rotativa activa (común/poco común/raro cada ${config.expShop.rotationHours} h · épico/legendario cada ${config.expShop.slowRotationHours} h)`);
}

module.exports = { start };
