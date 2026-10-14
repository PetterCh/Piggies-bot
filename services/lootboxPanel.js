// Panel interactivo de cajas: UN mensaje con arte, resumen de premios/probabilidades y 3 botones (uno por caja).
// Reemplaza al antiguo comando /lootbox. Los botones (lb:open:<caja>) son persistentes y los atiende commands/games/lootbox-admin.js.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { BOXES } = require('../data/lootboxes');
const { RARITIES, RARITY_INFO } = require('../data/gameData');
const { getGuildConfig, updateGuildConfig } = require('../utils/guildConfig');
const { t, langForGuild } = require('../utils/i18n');
const { withMedia } = require('../utils/media');
const { fmt } = require('../utils/helpers');
const config = require('../config');

const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
const STYLES = [ButtonStyle.Secondary, ButtonStyle.Primary, ButtonStyle.Success]; // un color por caja (en el orden de data/lootboxes.js)
const pct = (n) => (n >= 10 ? Math.round(n) : n >= 1 ? n.toFixed(1) : n.toFixed(2)).toString();

/** Resumen corto de una caja: % de nada / Coinks (rango) / accesorios (hasta qué rareza) / NFT. */
function boxSummary(L, box) {
  const total = box.table.reduce((a, e) => a + e.weight, 0);
  const share = (type) => box.table.filter((e) => e.type === type).reduce((a, e) => a + e.weight, 0) / total * 100;
  const coins = box.table.filter((e) => e.type === 'coinks');
  const gear = box.table.filter((e) => e.type === 'gear');
  const best = gear.sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity))[0];
  const parts1 = [t(L, 'lootboxPanel.nothing', { pct: pct(share('nothing')) })];
  if (coins.length) parts1.push(t(L, 'lootboxPanel.coinks', { pct: pct(share('coinks')), min: fmt(Math.min(...coins.map((e) => e.range[0]))), max: fmt(Math.max(...coins.map((e) => e.range[1]))) }));
  const parts2 = [];
  if (gear.length) parts2.push(t(L, 'lootboxPanel.gear', { pct: pct(share('gear')), best: `${RARITY_INFO[best.rarity].emoji} ${t(L, `rarity.${best.rarity}`)}`, bestPct: pct(best.weight / total * 100) }));
  if (share('nft') > 0) parts2.push(t(L, 'lootboxPanel.nft', { pct: pct(share('nft')) }));
  return [parts1.join(' · '), parts2.join(' · ')].filter(Boolean).join('\n');
}

/** Embed + botones del panel. `cfg.lootboxPanelImage` (https) manda sobre media.json ("lootbox.panel"). */
function buildPanel(L, cfg) {
  const cur = config.currency;
  const embed = new EmbedBuilder().setColor(0xf5a623).setTitle(t(L, 'lootboxPanel.title')).setDescription(t(L, 'lootboxPanel.desc'))
    .setFooter({ text: t(L, 'lootboxPanel.footer') });
  for (const box of Object.values(BOXES)) {
    embed.addFields({ name: `${box.emoji} ${t(L, `lootbox.box.${box.id}`)} — ${fmt(box.price)} ${cur.emoji}`, value: boxSummary(L, box) });
  }
  let files = [];
  if (cfg?.lootboxPanelImage) embed.setImage(cfg.lootboxPanelImage);
  else ({ files } = withMedia(embed, ['lootbox.panel']));
  const row = new ActionRowBuilder().addComponents(
    ...Object.values(BOXES).map((box, i) => new ButtonBuilder().setCustomId(`lb:open:${box.id}`).setStyle(STYLES[i] || ButtonStyle.Secondary).setEmoji('📦')
      .setLabel(t(L, 'lootboxPanel.btn', { price: fmt(box.price), currency: cur.name })))
  );
  return { embeds: [embed], components: [row], files };
}

/**
 * Publica (o actualiza) el panel en un canal. Si ya existe en ese mismo canal se EDITA el mensaje (así se conserva el enlace);
 * si cambia el canal, se borra el anterior. Devuelve el mensaje, o null si el canal no sirve.
 */
async function publishLootboxPanel(client, guildId, channelId) {
  const cfg = await getGuildConfig(guildId);
  const channel = await client.channels.fetch(channelId).catch(() => null);
  const guild = client.guilds.cache.get(guildId);
  if (!channel?.isTextBased() || !channel.permissionsFor(guild.members.me)?.has(NEEDED)) return null;
  const payload = buildPanel(langForGuild(guild), cfg);

  if (cfg.lootboxPanelMessageId && cfg.lootboxPanelChannelId) {
    const oldCh = await client.channels.fetch(cfg.lootboxPanelChannelId).catch(() => null);
    if (oldCh && oldCh.id === channel.id) {
      const msg = await oldCh.messages.fetch(cfg.lootboxPanelMessageId).catch(() => null);
      if (msg) return msg.edit({ ...payload, attachments: [] });
    } else if (oldCh) {
      await oldCh.messages.delete(cfg.lootboxPanelMessageId).catch(() => {});
    }
  }
  const msg = await channel.send(payload);
  await updateGuildConfig(guildId, { $set: { lootboxPanelChannelId: channel.id, lootboxPanelMessageId: msg.id } });
  return msg;
}

/** Quita el panel del canal y de la configuración. */
async function removeLootboxPanel(client, guildId) {
  const cfg = await getGuildConfig(guildId);
  if (cfg.lootboxPanelMessageId && cfg.lootboxPanelChannelId) {
    const ch = await client.channels.fetch(cfg.lootboxPanelChannelId).catch(() => null);
    await ch?.messages.delete(cfg.lootboxPanelMessageId).catch(() => {});
  }
  await updateGuildConfig(guildId, { $set: { lootboxPanelChannelId: null, lootboxPanelMessageId: null } });
}

module.exports = { buildPanel, boxSummary, publishLootboxPanel, removeLootboxPanel, NEEDED };
