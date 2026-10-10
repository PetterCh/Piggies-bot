const mongoose = require('mongoose');

// Libro contable: auditoría de TODO movimiento de Coinks (útil para detectar abusos o bugs).
const ledgerSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, index: true }, // admin_give, airdrop, transfer, game_entry, game_win, game_refund, expedition...
    fromId: { type: String, default: null, index: true },
    toId: { type: String, default: null, index: true },
    byId: { type: String, default: null }, // admin que ejecutó la acción, si aplica
    amount: { type: Number, required: true },
    reason: { type: String, default: '' },
    guildId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('Ledger', ledgerSchema);
