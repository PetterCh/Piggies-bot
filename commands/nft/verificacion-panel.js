// Panel de verificación estilo Collab.Land: un mensaje con botones. Los botones/modal son PERSISTENTES
// (no usan collectors), así que el panel sigue funcionando después de reiniciar el bot.
const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const WalletLink = require('../../models/WalletLink');
const config = require('../../config');
const { normalizeAddress } = require('../../utils/blockchain');
const { askConfirmation } = require('../../utils/confirm');
const { getGuildCollections, syncMember, walletsOf } = require('../../services/nftSync');
const { shortAddr } = require('../../utils/helpers');

const eph = { flags: MessageFlags.Ephemeral };

/** Clic en "Vincular Wallet": abre el modal (debe ser la PRIMERA respuesta a la interacción). */
async function onLinkButton(interaction) {
  const t = interaction.t;
  const count = await WalletLink.countDocuments({ discordId: interaction.user.id });
  if (count >= config.wallets.maxPerUser) return interaction.reply({ content: t('wallet.limit', { max: config.wallets.maxPerUser }), ...eph });

  const modal = new ModalBuilder().setCustomId('wl:modal').setTitle(t('wallet.modal.title')).addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('address')
        .setLabel(t('wallet.modal.label'))
        .setPlaceholder(t('wallet.modal.placeholder'))
        .setStyle(TextInputStyle.Short)
        .setMinLength(20)
        .setMaxLength(60)
        .setRequired(true)
    )
  );
  return interaction.showModal(modal);
}

/** Envío del modal: valida -> advertencia permanente + confirmación -> guarda -> sincroniza roles. */
async function onModalSubmit(interaction) {
  const t = interaction.t;
  await interaction.deferReply(eph);
  const discordId = interaction.user.id;
  const address = normalizeAddress(interaction.fields.getTextInputValue('address'));
  if (!address) return interaction.editReply(t('wallet.invalid'));

  if ((await WalletLink.countDocuments({ discordId })) >= config.wallets.maxPerUser) return interaction.editReply(t('wallet.limit', { max: config.wallets.maxPerUser }));
  if (await WalletLink.exists({ discordId, address })) return interaction.editReply(t('wallet.duplicate'));
  if (await WalletLink.exists({ address })) return interaction.editReply(t('wallet.taken'));

  const ok = await askConfirmation(interaction, { content: t('wallet.confirm', { address }) });
  if (!ok) return;

  try {
    await WalletLink.create({ discordId, address, guildId: interaction.guildId });
  } catch (err) {
    if (err.code === 11000) return interaction.editReply(t('wallet.raceTaken')); // el índice único evitó el duplicado
    throw err;
  }
  // Comprobación posterior al guardado: si dos modales llegaron a la vez, no se supera el máximo.
  if ((await WalletLink.countDocuments({ discordId })) > config.wallets.maxPerUser) {
    await WalletLink.deleteOne({ address, discordId });
    return interaction.editReply(t('wallet.limit', { max: config.wallets.maxPerUser }));
  }

  await interaction.editReply(t('wallet.linked'));
  try {
    const collections = await getGuildCollections(interaction.guildId);
    if (!collections.length) return interaction.editReply(t('wallet.noCollections', { short: shortAddr(address) }));
    const res = await syncMember(interaction.guild, interaction.member, await walletsOf(discordId), collections);
    const msg = res.added.length ? t('wallet.rolesGiven', { roles: res.added.map((id) => `<@&${id}>`).join(', ') }) : t('wallet.noRolesFound');
    return interaction.editReply({ content: t('wallet.done', { short: shortAddr(address), msg }), allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[wallet] sync inicial:', err);
    return interaction.editReply(t('wallet.syncFail'));
  }
}

/** Botón "Mis wallets". */
async function onListButton(interaction) {
  const t = interaction.t;
  const links = await WalletLink.find({ discordId: interaction.user.id }).sort({ createdAt: 1 }).lean();
  if (!links.length) return interaction.reply({ content: t('wallet.list.empty'), ...eph });
  const lines = links.map((l, i) => `${i + 1}. \`${l.address}\` — <t:${Math.floor(l.createdAt.getTime() / 1000)}:d>`).join('\n');
  return interaction.reply({ content: `${t('wallet.list.header', { n: links.length, max: config.wallets.maxPerUser })}\n${lines}`, ...eph });
}

module.exports = {
  adminOnly: true, // la comprobación real vive en events/interactionCreate.js
  data: new SlashCommandBuilder()
    .setName('verificacion-panel')
    .setDescription('(Admin) Publica el panel de verificación de wallets en este canal')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const t = interaction.t;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(t('wallet.panel.title'))
      .setDescription(t('wallet.panel.description', { max: config.wallets.maxPerUser }))
      .setFooter({ text: t('wallet.panel.footer') });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('wl:link').setStyle(ButtonStyle.Success).setEmoji('🔗').setLabel(t('wallet.panel.btnLink')),
      new ButtonBuilder().setCustomId('wl:list').setStyle(ButtonStyle.Secondary).setEmoji('👛').setLabel(t('wallet.panel.btnList'))
    );
    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: t('wallet.panel.posted'), ...eph });
  },

  components: [
    { kind: 'button', prefix: 'wl', execute: (i, args) => (args[0] === 'list' ? onListButton(i) : onLinkButton(i)) },
    { kind: 'modal', prefix: 'wl', execute: (i) => onModalSubmit(i) },
  ],
};
