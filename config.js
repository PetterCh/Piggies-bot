// Configuración central. Todo lo "ajustable" vive aquí para no tocar la lógica.
require('dotenv').config();

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const adminRoleIds = list(process.env.ADMIN_ROLE_IDS || process.env.ECONOMY_ADMIN_ROLE_IDS);

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,
  mongoUri: process.env.MONGODB_URI,

  // Roles (además de Administrator) que pueden usar TODOS los comandos de administración del bot.
  adminRoleIds,
  economyAdminRoleIds: adminRoleIds, // alias por compatibilidad con la versión anterior

  // Canal donde el bot avisa a los admins (pedidos de tienda, NFTs ganados...). Opcional.
  logChannelId: process.env.ADMIN_LOG_CHANNEL_ID || null,

  // Idioma por defecto si no se puede detectar (el usuario siempre puede forzarlo con /idioma).
  defaultLang: process.env.DEFAULT_LANG === 'es' ? 'es' : 'en', // inglés salvo que pongas DEFAULT_LANG=es

  currency: { name: 'Coinks', emoji: '🪙' },

  chains: {
    EVM: { rpcUrl: process.env.RPC_EVM_URL || 'https://eth.llamarpc.com' },
    RONIN: { rpcUrl: process.env.RPC_RONIN_URL || 'https://api.roninchain.com/rpc' },
  },

  wallets: { maxPerUser: Number(process.env.MAX_WALLETS_PER_USER) || 5 },

  nft: {
    cron: process.env.NFT_SYNC_CRON || '0 3 * * *',
    timezone: process.env.CRON_TIMEZONE || 'UTC',
    maxTokensPerWallet: 300, // con metadatos (reglas por rasgo)
    maxIdsPerWallet: 3000, // solo IDs (roles por Token ID), sin metadatos
    concurrency: Number(process.env.NFT_RPC_CONCURRENCY) || 3, // lecturas RPC simultáneas; bájalo si tu proveedor limita (400/429)
    walletConcurrency: 3,
    metadataTimeoutMs: 8000,
    ipfsGateway: 'https://ipfs.io/ipfs/',
    // Índice interno de Token IDs (roles 1/1): el bot lo llena solo, en segundo plano y muy despacio (ver services/tokenOwners.js).
    tokenOwners: {
      auto: process.env.TOKEN_OWNERS_AUTO !== 'off', // TOKEN_OWNERS_AUTO=off lo desactiva (solo import/actualizar manual)
      cron: process.env.TOKEN_OWNERS_CRON || '30 2 * * *', // refresco diario, antes de la sincronización de las 03:00
      delayMs: Number(process.env.TOKEN_OWNERS_DELAY_MS) || 400, // pausa entre lecturas
    },
  },

  // Leaderboard mensual. Zona horaria del cierre de mes: LEADERBOARD_TIMEZONE (o CRON_TIMEZONE, o UTC).
  leaderboard: {
    timezone: process.env.LEADERBOARD_TIMEZONE || process.env.CRON_TIMEZONE || 'UTC',
    seasonCron: process.env.LEADERBOARD_SEASON_CRON || '5 0 1 * *', // día 1 de cada mes, 00:05
    refreshMinutes: Number(process.env.LEADERBOARD_REFRESH_MIN) || 10, // refresco automático del panel
    size: 10,
    liveRoles: process.env.LEADERBOARD_LIVE_ROLES !== 'off', // true = los roles por puesto se actualizan al refrescar el panel; 'off' = solo al cerrar la temporada
    // IDs de Discord que NUNCA salen en la tabla (separados por comas). Se suman a los que añadas con /leaderboard-admin excluir.
    blacklistIds: (process.env.LEADERBOARD_BLACKLIST_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  },

  colorGame: { defaultEntry: 100, minEntry: 1, maxEntry: 100000, lobbySeconds: 30, minPlayers: 2, roundDelayMs: 3000 },

  expeditions: { checkIntervalMs: 30_000 },

  giveaways: {
    checkIntervalMs: 15_000,
    minDurationMs: 60_000,
    maxDurationMs: 30 * 24 * 3600_000,
    maxWinners: 20,
  },



  // ephemeral=true: el resultado de abrir una caja desde el panel lo ve solo quien la abre. LOOTBOX_PUBLIC=on lo hace público en el canal.
  lootbox: { openDelayMs: 2500, ephemeral: process.env.LOOTBOX_PUBLIC !== 'on' },

  // Eventos globales sorpresa: tras terminar uno, el siguiente aparece pasadas entre minGapHours y maxGapHours.
  events: { checkIntervalMs: 60_000, minGapHours: 8, maxGapHours: 72 },

  // Log de compras: una compra de esta cantidad o más (o un NFT, o un objeto épico/legendario) sale destacada.
  purchases: { highlightMinCoins: Number(process.env.PURCHASE_HIGHLIGHT_MIN) || 5000 },

  // Tienda de expedición rotativa
  // Dos frecuencias INDEPENDIENTES: común/poco común/raro rotan cada `rotationHours` (12 h) y épico/legendario cada `slowRotationHours` (24 h).
  expShop: {
    rotationHours: Number(process.env.EXPSHOP_ROTATION_HOURS) || 12,
    slowRotationHours: Number(process.env.EXPSHOP_SLOW_ROTATION_HOURS) || 24,
    checkIntervalMs: 60_000,
  },
};
