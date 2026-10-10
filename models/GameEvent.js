const mongoose = require('mongoose');

const gameEventSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    typeId: { type: String, required: true },
    startedAt: { type: Date, required: true }, // en un evento 'scheduled' es la hora programada de inicio
    endsAt: { type: Date, required: true },
    status: { type: String, enum: ['scheduled', 'active', 'ended', 'cancelled'], default: 'active' },
    forcedBy: { type: String, default: null }, // admin que lo lanzó a mano (null = automático)
  },
  { timestamps: true }
);
gameEventSchema.index({ guildId: 1, status: 1, endsAt: 1 });

module.exports = mongoose.model('GameEvent', gameEventSchema);
