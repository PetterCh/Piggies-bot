const mongoose = require('mongoose');

// Partidas del Panel Arcade (Piggy Crash y Buscaminas). TODO el estado vive aquí, en el servidor: el cliente nunca recibe el punto de
// explosión ni las bombas hasta que la partida termina. `open:true` = partida en curso (índice único parcial: una sola por usuario).
const arcadeGameSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    userName: { type: String, default: '' }, // para el leaderboard de la web
    guildId: { type: String, default: null },
    game: { type: String, enum: ['crash', 'mines'], required: true },
    status: { type: String, enum: ['pending', 'active', 'cashed', 'lost', 'void'], default: 'pending' },
    open: { type: Boolean, default: true },
    bet: { type: Number, required: true },
    // Crash
    crashPoint: { type: Number, default: null, select: false },
    startedAt: { type: Date, default: null },
    // Mines
    edge: { type: Number, default: 0.04 }, // ventaja de la casa con la que se creó la partida
    bombCount: { type: Number, default: 0 },
    bombs: { type: [Number], default: [], select: false },
    revealed: { type: [Number], default: [] },
    hit: { type: Number, default: null },
    // Resultado
    cashMult: { type: Number, default: 0 },
    payout: { type: Number, default: 0 },
    profit: { type: Number, default: 0 },
    paid: { type: Boolean, default: true }, // false = ganada pero aún sin abonar (se reintenta sola)
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
arcadeGameSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { open: true } }); // una partida abierta por usuario
arcadeGameSchema.index({ status: 1, endedAt: -1 });

module.exports = mongoose.model('ArcadeGame', arcadeGameSchema);
