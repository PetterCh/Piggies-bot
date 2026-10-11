const mongoose = require('mongoose');

const expeditionSchema = new mongoose.Schema(
  {
    discordId: { type: String, required: true, index: true },
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    zoneId: { type: String, required: true },
    lang: { type: String, enum: ['es', 'en'], default: () => require('../config').defaultLang }, // idioma con el que se avisará al regresar
    startedAt: { type: Date, required: true },
    endsAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ['active', 'resolving', 'completed', 'cancelled'], default: 'active', index: true },
    open: { type: Boolean, default: true },
    equipmentSnapshot: {
      weapon: { type: String, default: null },
      armor: { type: String, default: null },
      helmet: { type: String, default: null },
    },
    eventId: { type: String, default: null }, // evento global activo cuando salió (sus efectos se fijan al salir)
    survivalChance: { type: Number, required: true },
    result: { survived: Boolean, revived: Boolean, coinks: Number, rarity: String, droppedItem: String, eventItem: String, broken: [String] },
    completedAt: Date,
  },
  { timestamps: true }
);

// Un usuario solo puede tener UNA expedición abierta (regla garantizada por la propia BD).
expeditionSchema.index({ discordId: 1 }, { unique: true, partialFilterExpression: { open: true } });

module.exports = mongoose.model('Expedition', expeditionSchema);
