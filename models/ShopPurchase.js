const mongoose = require('mongoose');

const shopPurchaseSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    itemName: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    price: { type: Number, required: true },
    status: { type: String, enum: ['completed', 'pending', 'delivered', 'refunded'], required: true, index: true },
    deliveredBy: { type: String, default: null },
    deliveredAt: { type: Date, default: null },
    txHash: { type: String, default: null }, // hash del envío (NFT)
  },
  { timestamps: true }
);

module.exports = mongoose.model('ShopPurchase', shopPurchaseSchema);
