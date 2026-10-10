const mongoose = require('mongoose');

const shopItemSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    nameKey: { type: String, required: true },
    description: { type: String, default: '' },
    price: { type: Number, required: true, min: 1 },
    type: { type: String, enum: ['role', 'manual', 'nft'], default: 'manual' }, // role = automática; manual = la entrega un admin; nft = envío manual a la wallet vinculada
    roleId: { type: String, default: null },
    nftNetwork: { type: String, default: null }, // datos informativos de un artículo tipo NFT
    nftContract: { type: String, default: null },
    nftTokenId: { type: String, default: null },
    stock: { type: Number, default: null, min: 0 }, // null = ilimitado
    sold: { type: Number, default: 0 },
    maxPerUser: { type: Number, default: 0 }, // 0 = sin límite
    imageUrl: { type: String, default: null },
    active: { type: Boolean, default: true },
    storeMessageId: { type: String, default: null }, // tarjeta publicada en el canal de la tienda
    storeChannelId: { type: String, default: null },
  },
  { timestamps: true }
);
shopItemSchema.index({ guildId: 1, nameKey: 1 }, { unique: true });

module.exports = mongoose.model('ShopItem', shopItemSchema);
