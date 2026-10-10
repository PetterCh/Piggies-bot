const mongoose = require('mongoose');

const giveawaySchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    hostId: { type: String, required: true },
    lang: { type: String, enum: ['es', 'en'], default: 'es' },
    prizeText: { type: String, default: null }, // premio "físico"/manual (WL, merch...)
    prizeCoinks: { type: Number, default: 0 }, // Coinks por ganador
    entryCost: { type: Number, default: 0 }, // 0 = gratis
    winnersCount: { type: Number, default: 1, min: 1 },
    endsAt: { type: Date, required: true },
    status: { type: String, enum: ['active', 'ending', 'ended', 'cancelled'], default: 'active' },
    entries: { type: [String], default: [] },
    winners: { type: [String], default: [] },
    paid: { type: [String], default: [] }, // ganadores a los que ya se les acreditaron los Coinks
  },
  { timestamps: true }
);
giveawaySchema.index({ status: 1, endsAt: 1 });

module.exports = mongoose.model('Giveaway', giveawaySchema);
