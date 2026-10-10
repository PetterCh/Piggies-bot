const mongoose = require('mongoose');

// Panel de auto-roles: un mensaje con botones; cada botón activa/desactiva un rol al que lo pulsa.
const roleButtonSchema = new mongoose.Schema(
  {
    roleId: { type: String, required: true },
    label: { type: String, required: true },
    emoji: { type: String, default: null },
    description: { type: String, default: '' },
  },
  { _id: false }
);

const rolePanelSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    color: { type: Number, default: 0x5865f2 },
    roles: { type: [roleButtonSchema], default: [] }, // máximo 25 (5 filas de 5 botones)
    createdBy: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RolePanel', rolePanelSchema);
