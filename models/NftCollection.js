const mongoose = require('mongoose');

// Regla: si el NFT tiene el atributo (traitType = value) se concede roleId.
const traitRoleSchema = new mongoose.Schema(
  {
    traitType: { type: String, required: true },
    value: { type: String, required: true },
    roleId: { type: String, required: true },
  },
  { _id: false }
);

const nftCollectionSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    nameKey: { type: String, required: true }, // nombre en minúsculas para búsquedas
    contractAddress: { type: String, required: true }, // 0x... en minúsculas
    network: { type: String, enum: ['EVM', 'RONIN'], required: true },
    rpcUrl: { type: String, default: null }, // sobrescribe el RPC por defecto de la red
    holderRoleId: { type: String, default: null }, // rol por ser holder general
    traitRoles: { type: [traitRoleSchema], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

nftCollectionSchema.index({ guildId: 1, contractAddress: 1, network: 1 }, { unique: true });
nftCollectionSchema.index({ guildId: 1, nameKey: 1 }, { unique: true });

module.exports = mongoose.model('NftCollection', nftCollectionSchema);
