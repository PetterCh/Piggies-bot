const mongoose = require('mongoose');

// Registro de acciones administrativas (desvincular wallets, cambios en la tienda, entregas de NFT...).
const auditLogSchema = new mongoose.Schema(
  {
    guildId: { type: String, default: null },
    action: { type: String, required: true, index: true },
    byId: { type: String, default: null },
    targetId: { type: String, default: null, index: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
