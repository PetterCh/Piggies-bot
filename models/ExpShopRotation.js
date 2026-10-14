const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true },
    price: { type: Number, required: true },
    stock: { type: Number, required: true }, // unidades restantes (compartidas por todo el servidor)
    total: { type: Number, required: true },
    sold: { type: Number, default: 0 },
    buyers: { type: [String], default: [] }, // máximo 1 unidad por persona y rotación
    messageId: { type: String, default: null }, // tarjeta en el canal
  },
  { _id: false }
);

// Una rotación = el escaparate de UN nivel: 'fast' (común, poco común, raro: cada 12 h) o 'slow' (épico y legendario: cada 24 h).
// Cada nivel tiene su propia cuenta de franjas y rota por su cuenta. (Las rotaciones antiguas, sin `tier`, mezclaban todo y caducan solas.)
const expShopRotationSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    tier: { type: String, enum: ['fast', 'slow', 'legacy'], default: 'fast' },
    slot: { type: Number, required: true }, // floor(ahora / duración del nivel): identifica la rotación de forma única
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    items: { type: [itemSchema], default: [] },
    published: { type: Boolean, default: false },
    channelId: { type: String, default: null },
    headerMessageId: { type: String, default: null },
  },
  { timestamps: true }
);
expShopRotationSchema.index({ guildId: 1, tier: 1, slot: 1 }, { unique: true }); // impide crear dos veces la misma rotación del mismo nivel

module.exports = mongoose.model('ExpShopRotation', expShopRotationSchema);
