const mongoose = require('mongoose');

// v2 — MÚLTIPLES WALLETS: un usuario puede tener varias (límite en config.wallets.maxPerUser),
// pero cada DIRECCIÓN sigue siendo única en toda la colección: una wallet = una sola cuenta de Discord.
// (El índice único antiguo sobre discordId se elimina en migrations/001-multiwallet.js.)
const walletLinkSchema = new mongoose.Schema(
  {
    discordId: { type: String, required: true, index: true },
    address: { type: String, required: true, unique: true }, // 0x... en minúsculas
    guildId: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WalletLink', walletLinkSchema);
