// Anuncios públicos de premios de lootbox en el canal de logs (/set-logs-channel).
const { EmbedBuilder } = require('discord.js');
const { getGuildConfig } = require('../utils/guildConfig');
const { t, langForGuild } = require('../utils/i18n');
const { withMedia } = require('../utils/media');
const { RARITY_INFO, ITEMS } = require('../data/gameData');
const { fmt } = require('../utils/helpers');

const RANK = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const EPIC = RANK.indexOf('epic');
const PING_COOLDOWN_MS = 60_000; // máximo un @everyone por minuto y servidor (anti-spam si alguien farmea cajas)
const lastPing = new Map();

async function announceWin(client, guild, { user, box, outcome, prize }) {
  if (!guild || outcome.type === 'nothing') return; // las cajas vacías no se anuncian
  const cfg = await getGuildConfig(guild.id);
  if (!cfg.logsChannelId) return;

  const isNft = outcome.type === 'nft';
  const rank = RANK.indexOf(outcome.rarity);
  if (!isNft && rank < RANK.indexOf(cfg.logsMinRarity || 'common')) return;

  const channel = await client.channels.fetch(cfg.logsChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const L = langForGuild(guild);
  const hype = isNft ? prize?.highValue !== false : rank >= EPIC; // épico/legendario o NFT de alto valor
  const rarityText = RARITY_INFO[outcome.rarity] ? `${RARITY_INFO[outcome.rarity].emoji} ${t(L, `rarity.${outcome.rarity}`)}` : '';

  let prizeName;
  let desc;
  if (outcome.type === 'coinks') {
    prizeName = `${fmt(outcome.coinks)} Coinks`;
    desc = t(L, 'lootboxLog.coinks', { user: `<@${user.id}>`, coinks: fmt(outcome.coinks), rarity: rarityText });
  } else if (outcome.type === 'gear') {
    const it = ITEMS[outcome.itemId];
    prizeName = t(L, `item.${outcome.itemId}`);
    desc = t(L, 'lootboxLog.gear', { user: `<@${user.id}>`, item: prizeName, rarity: rarityText, slot: t(L, `slot.${it.type}`), bonus: Math.round(it.bonus * 100) });
  } else {
    prizeName = prize.name;
    desc = t(L, 'lootboxLog.nft', { user: `<@${user.id}>`, name: prize.name });
  }

  const embed = new EmbedBuilder()
    .setColor(isNft ? 0xff3df2 : RARITY_INFO[outcome.rarity].color)
    .setTitle(t(L, 'lootboxLog.title', { emoji: box.emoji, box: t(L, `lootbox.box.${box.id}`) }))
    .setDescription(desc)
    .setThumbnail(user.displayAvatarURL());
  const { files } = withMedia(embed, [`lootbox.${outcome.rarity}`]);
  if (!embed.data.image && isNft && prize.imageUrl && /^https:\/\//i.test(prize.imageUrl)) embed.setImage(prize.imageUrl);

  // Menciona al rol de drops (/set-ping-role tipo:lootbox) o, si no hay, a @everyone (si está activado), solo si el premio lo
  // merece y no hubo otro ping hace menos de 1 minuto.
  const now = Date.now();
  const pingTarget = cfg.dropsRoleId ? `<@&${cfg.dropsRoleId}>` : cfg.logsEveryone ? '@everyone' : null;
  const canPing = !!pingTarget && hype && now - (lastPing.get(guild.id) || 0) > PING_COOLDOWN_MS;
  if (canPing) lastPing.set(guild.id, now);
  const hypeText = hype ? t(L, isNft ? 'lootboxLog.hypeNft' : 'lootboxLog.hypeEpic', { user: `<@${user.id}>`, prize: prizeName }) : '';

  await channel.send({
    content: canPing ? `${pingTarget} ${hypeText}` : hypeText || undefined,
    embeds: [embed],
    files,
    allowedMentions: canPing ? (cfg.dropsRoleId ? { parse: [], roles: [cfg.dropsRoleId] } : { parse: ['everyone'] }) : { parse: [] },
  });
}

module.exports = { announceWin };
