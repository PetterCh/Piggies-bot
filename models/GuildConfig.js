const mongoose = require('mongoose');

// Configuración por servidor (se edita con /set-admin-role, /set-store-channel y /set-logs-channel).
const guildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true },
    adminRoleIds: { type: [String], default: [] }, // roles autorizados para las herramientas administrativas
    storeChannelId: { type: String, default: null }, // canal donde el bot mantiene la tienda
    logsChannelId: { type: String, default: null }, // canal de anuncios públicos de lootboxes
    logsEveryone: { type: Boolean, default: true }, // @everyone en premios épicos / NFT de alto valor
    logsMinRarity: { type: String, enum: ['common', 'uncommon', 'rare', 'epic', 'legendary'], default: 'common' }, // premio mínimo a anunciar
    eventsChannelId: { type: String, default: null }, // canal de eventos globales y premios de evento
    purchasesChannelId: { type: String, default: null }, // canal de logs de compras (tiendas)
    purchasesPublic: { type: Boolean, default: false }, // true = el log oculta wallets completas e IDs de pedido
    dropsRoleId: { type: String, default: null }, // rol a mencionar en premios épicos/NFT de lootbox (en vez de @everyone)
    shopRoleId: { type: String, default: null }, // rol a mencionar en novedades de la tienda (artículo nuevo / rotación nueva)
    eventsRoleId: { type: String, default: null }, // rol a mencionar al empezar y al terminar un evento
    eventsEveryone: { type: Boolean, default: false }, // @everyone al empezar un evento
    eventsEnabled: { type: Boolean, default: true },
    nextEventAt: { type: Date, default: null }, // cuándo puede aparecer el siguiente evento sorpresa
    lastEventType: { type: String, default: null },
    expShopChannelId: { type: String, default: null }, // canal de la tienda de expedición rotativa
  },
  { timestamps: true }
);

module.exports = mongoose.model('GuildConfig', guildConfigSchema);
