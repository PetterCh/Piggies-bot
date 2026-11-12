const { Events } = require('discord.js');
const nftSyncTask = require('../tasks/nftSyncTask');
const tokenOwnersTask = require('../tasks/tokenOwnersTask');
const expeditionTask = require('../tasks/expeditionTask');
const giveawayTask = require('../tasks/giveawayTask');
const eventTask = require('../tasks/eventTask');
const expShopTask = require('../tasks/expShopTask');
const leaderboardTask = require('../tasks/leaderboardTask');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(readyClient) {
    console.log(`✅ Conectado como ${readyClient.user.tag}`);
    require('../services/arcadeLog').setClient(readyClient); // avisos del Arcade en el canal de logs
    nftSyncTask.start(readyClient);
    tokenOwnersTask.start(readyClient);
    expeditionTask.start(readyClient);
    giveawayTask.start(readyClient);
    eventTask.start(readyClient);
    expShopTask.start(readyClient);
    leaderboardTask.start(readyClient);
  },
};
