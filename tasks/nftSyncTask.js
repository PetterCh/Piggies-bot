const cron = require('node-cron');
const config = require('../config');
const { syncAllGuilds } = require('../services/nftSync');

/** Programa la revisión periódica (por defecto cada 24 h a las 03:00). */
function start(client) {
  cron.schedule(config.nft.cron, () => syncAllGuilds(client).catch((e) => console.error('[nft] cron:', e)), {
    timezone: config.nft.timezone,
  });
  console.log(`[tasks] Sync NFT programado: "${config.nft.cron}" (${config.nft.timezone})`);
}

module.exports = { start };
