const mongoose = require('mongoose');
// Pares clave/valor globales del bot (p. ej. el mes en curso del contador del leaderboard). Colección nueva: no afecta a nada existente.
module.exports = mongoose.model('BotMeta', new mongoose.Schema({ _id: { type: String }, value: { type: mongoose.Schema.Types.Mixed, default: null } }, { timestamps: true }));
