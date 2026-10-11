const mongoose = require('mongoose');

// Índice INTERNO de quién tiene cada Token ID (solo los de los grupos de data/token-roles.json).
// La verificación de roles por Token ID lee ÚNICAMENTE esta colección: nunca llama a la blockchain.
// Se llena con /nft-registrar tokens-importar (archivo, 0 llamadas a la cadena) o con /nft-registrar tokens-actualizar (lento, bajo demanda).
const tokenOwnerSchema = new mongoose.Schema(
  {
    network: { type: String, required: true },
    contractAddress: { type: String, required: true }, // 0x… minúsculas
    tokenId: { type: String, required: true },
    owner: { type: String, default: null }, // wallet 0x… minúsculas; null = quemado / sin dueño
    source: { type: String, enum: ['import', 'chain'], default: 'import' },
  },
  { timestamps: true }
);
tokenOwnerSchema.index({ network: 1, contractAddress: 1, tokenId: 1 }, { unique: true });

module.exports = mongoose.model('TokenOwner', tokenOwnerSchema);
