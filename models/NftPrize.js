const mongoose = require('mongoose');

// NFT real que se entrega como premio de lootbox. El bot NO custodia NFTs ni claves privadas:
// solo reserva el premio para el ganador y un admin lo envía a su wallet vinculada.
const nftPrizeSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    imageUrl: { type: String, default: null },
    network: { type: String, enum: ['EVM', 'RONIN'], default: 'EVM' },
    contractAddress: { type: String, default: null },
    tokenId: { type: String, default: null },
    highValue: { type: Boolean, default: true }, // true = al ganarlo se hace @everyone en el canal de logs
    status: { type: String, enum: ['available', 'won', 'delivered'], default: 'available', index: true },
    wonBy: { type: String, default: null },
    wonAt: { type: Date, default: null },
    deliveredBy: { type: String, default: null },
    deliveredAt: { type: Date, default: null },
    txHash: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NftPrize', nftPrizeSchema);
