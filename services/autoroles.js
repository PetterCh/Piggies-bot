// Panel de auto-roles por botones.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const { getGuildConfig } = require('../utils/guildConfig');
const { t, langForGuild } = require('../utils/i18n');

const MAX_BUTTONS = 25; // 5 filas x 5 botones

// Un auto-rol NUNCA puede dar poder de moderación/administración (escalada de privilegios).
const DANGEROUS = [
  'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'ManageMessages', 'ManageNicknames', 'ManageThreads',
  'ManageEvents', 'ManageGuildExpressions', 'KickMembers', 'BanMembers', 'ModerateMembers', 'MentionEveryone', 'ViewAuditLog',
].map((k) => PermissionFlagsBits[k]).filter((b) => b !== undefined);

/** Motivo por el que un rol NO se puede usar como auto-rol, o null si es válido. */
async function roleProblem(guild, role) {
  const r = guild.roles.cache.get(role.id);
  if (!r || r.id === guild.id) return 'everyone';
  if (r.managed) return 'managed';
  if (DANGEROUS.some((bit) => r.permissions.has(bit))) return 'dangerous';
  const cfg = await getGuildConfig(guild.id);
  if ([...cfg.adminRoleIds, ...config.adminRoleIds].includes(r.id)) return 'adminRole'; // un rol de admin del bot no se autoasigna
  if (!r.editable) return 'hierarchy';
  return null;
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Mensaje del panel: embed con la lista de roles + filas de botones (máx. 5 por fila). */
function buildPanelPayload(panel, guild) {
  const L = langForGuild(guild);
  const lines = panel.roles.map((r) => `${r.emoji ? `${r.emoji} ` : ''}**${r.label}** — <@&${r.roleId}>${r.description ? `\n> ${r.description}` : ''}`);
  const embed = new EmbedBuilder().setColor(panel.color).setTitle(panel.title)
    .setDescription([panel.description, lines.join('\n')].filter(Boolean).join('\n\n') || t(L, 'autoroles.emptyPanel'))
    .setFooter({ text: t(L, 'autoroles.footer') });
  const buttons = panel.roles.map((r) => {
    const b = new ButtonBuilder().setCustomId(`ar:${panel._id}:${r.roleId}`).setStyle(ButtonStyle.Secondary).setLabel(r.label.slice(0, 80));
    if (r.emoji) b.setEmoji(r.emoji);
    return b;
  });
  return { embeds: [embed], components: chunk(buttons, 5).map((row) => new ActionRowBuilder().addComponents(row)), allowedMentions: { parse: [] } };
}

/** Publica o actualiza el mensaje del panel (si lo borraron, lo vuelve a publicar). */
async function refreshPanel(client, panel) {
  const guild = client.guilds.cache.get(panel.guildId);
  const channel = await client.channels.fetch(panel.channelId).catch(() => null);
  if (!guild || !channel?.isTextBased()) return false;
  const payload = buildPanelPayload(panel, guild);
  if (panel.messageId) {
    try {
      await (await channel.messages.fetch(panel.messageId)).edit(payload);
      return true;
    } catch { /* mensaje borrado: se republica */ }
  }
  const msg = await channel.send(payload);
  panel.messageId = msg.id;
  await panel.save();
  return true;
}

async function deletePanelMessage(client, panel) {
  if (!panel.messageId) return;
  const channel = await client.channels.fetch(panel.channelId).catch(() => null);
  await channel?.messages?.delete(panel.messageId).catch(() => {});
}

module.exports = { MAX_BUTTONS, DANGEROUS, roleProblem, chunk, buildPanelPayload, refreshPanel, deletePanelMessage };
