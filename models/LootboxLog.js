const mongoose = require('mongoose');

// Historial de aperturas: sirve para auditar que las probabilidades reales coinciden con las configuradas.
const lootboxLogSchema = new mongoose.Schema(
  {
    guildId: { type: String, default: null },
    userId: { type: String, required: true, index: true },
    boxId: { type: String, required: true, index: true },
    price: { type: Number, required: true },
    type: { type: String, required: true }, // nothing | coinks | gear | nft
    rarity: { type: String, default: null },
    coinks: { type: Number, default: 0 },
    itemId: { type: String, default: null },
    nftPrizeId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('LootboxLog', lootboxLogSchema);
