const { Events } = require('discord.js');
const nftSyncTask = require('../tasks/nftSyncTask');
const expeditionTask = require('../tasks/expeditionTask');
const giveawayTask = require('../tasks/giveawayTask');
const eventTask = require('../tasks/eventTask');
const expShopTask = require('../tasks/expShopTask');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(readyClient) {
    console.log(`✅ Conectado como ${readyClient.user.tag}`);
    nftSyncTask.start(readyClient);
    expeditionTask.start(readyClient);
    giveawayTask.start(readyClient);
    eventTask.start(readyClient);
    expShopTask.start(readyClient);
  },
};
