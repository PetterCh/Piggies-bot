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

// Una rotación = un "escaparate" de ~10 objetos que dura rotationHours (por defecto 12 h = 2 rotaciones al día).
const expShopRotationSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    slot: { type: Number, required: true }, // floor(ahora / duración): identifica la rotación de forma única
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    items: { type: [itemSchema], default: [] },
    published: { type: Boolean, default: false },
    channelId: { type: String, default: null },
    headerMessageId: { type: String, default: null },
  },
  { timestamps: true }
);
expShopRotationSchema.index({ guildId: 1, slot: 1 }, { unique: true }); // impide crear dos veces la misma rotación

module.exports = mongoose.model('ExpShopRotation', expShopRotationSchema);
