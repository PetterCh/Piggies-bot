const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema({
  itemId: { type: String, required: true }, // clave en data/gameData.js
  obtainedAt: { type: Date, default: Date.now },
  usesLeft: { type: Number, default: null }, // usos restantes (solo objetos exclusivos; null = ilimitado)
});

const userSchema = new mongoose.Schema(
  {
    discordId: { type: String, required: true, unique: true },
    coinks: { type: Number, default: 0, min: 0 },
    lang: { type: String, enum: ['es', 'en'], default: null }, // preferencia manual; null = detección automática
    piggy: {
      name: { type: String, default: 'Cerdito' },
      equipped: {
        weapon: { type: String, default: null },
        armor: { type: String, default: null },
        helmet: { type: String, default: null }, // v2: ranura nueva (los usuarios antiguos la reciben como null)
      },
      // usos restantes del objeto EQUIPADO en cada ranura (null = ilimitado)
      equippedUses: {
        weapon: { type: Number, default: null },
        armor: { type: Number, default: null },
        helmet: { type: Number, default: null },
      },
      inventory: { type: [inventoryItemSchema], default: [] },
      stats: {
        expeditions: { type: Number, default: 0 },
        survived: { type: Number, default: 0 },
        deaths: { type: Number, default: 0 },
        totalLoot: { type: Number, default: 0 },
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
