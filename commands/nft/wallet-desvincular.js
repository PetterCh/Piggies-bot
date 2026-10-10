const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const WalletLink = require('../../models/WalletLink');
const { normalizeAddress } = require('../../utils/blockchain');
const { askConfirmation } = require('../../utils/confirm');
const { audit } = require('../../utils/adminLog');
const { getGuildCollections, syncMember, walletsOf } = require('../../services/nftSync');
const { shortAddr } = require('../../utils/helpers');

module.exports = {
  adminOnly: true, // la comprobación real vive en events/interactionCreate.js
  data: new SlashCommandBuilder()
    .setName('wallet-desvincular')
    .setDescription('(Admin) Desvincula wallets de un usuario (error de tipeo o suplantación)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('usuario').setDescription('Usuario afectado').setRequired(true))
    .addStringOption((o) => o.setName('direccion').setDescription('Wallet a quitar (vacío = la única que tenga)').setAutocomplete(true))
    .addBooleanOption((o) => o.setName('todas').setDescription('Quitar TODAS sus wallets'))
    .addStringOption((o) => o.setName('motivo').setDescription('Motivo (queda en el registro de auditoría)').setMaxLength(200)),

  // Sugiere las wallets del usuario elegido en la opción "usuario".
  async autocomplete(interaction) {
    const uid = interaction.options.get('usuario')?.value;
    if (!uid) return interaction.respond([]);
    const q = interaction.options.getFocused().toLowerCase();
    const links = await WalletLink.find({ discordId: uid }).lean();
    await interaction.respond(
      links.filter((l) => l.address.includes(q)).slice(0, 25).map((l) => ({ name: `${shortAddr(l.address)}  (${l.address})`.slice(0, 100), value: l.address }))
    );
  },

  async execute(interaction) {
    const t = interaction.t;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = interaction.options.getUser('usuario', true);
    const rawAddr = interaction.options.getString('direccion');
    const all = interaction.options.getBoolean('todas') ?? false;
    const reason = interaction.options.getString('motivo') || '-';

    const links = await WalletLink.find({ discordId: target.id }).lean();
    if (!links.length) return interaction.editReply(t('unlink.none', { user: `<@${target.id}>` }));

    let toRemove;
    if (all) toRemove = links;
    else if (rawAddr) {
      const a = normalizeAddress(rawAddr);
      toRemove = links.filter((l) => l.address === a);
      if (!toRemove.length) return interaction.editReply(t('unlink.notFound'));
    } else if (links.length === 1) toRemove = links;
    else return interaction.editReply(t('unlink.specify', { n: links.length }));

    const ok = await askConfirmation(interaction, {
      content: t('unlink.confirm', { user: `<@${target.id}>`, wallets: toRemove.map((l) => `\`${l.address}\``).join('\n') }),
    });
    if (!ok) return;

    await WalletLink.deleteMany({ discordId: target.id, address: { $in: toRemove.map((l) => l.address) } });
    await audit({ guildId: interaction.guildId, action: 'wallet_unlink', byId: interaction.user.id, targetId: target.id, details: { wallets: toRemove.map((l) => l.address), reason } });

    // Recalcula los roles con las wallets que le queden (si no le queda ninguna, pierde los roles NFT).
    let rolesNote = '';
    try {
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      const collections = await getGuildCollections(interaction.guildId);
      if (member && collections.length) {
        const res = await syncMember(interaction.guild, member, await walletsOf(target.id), collections);
        if (res.removed.length) rolesNote = t('unlink.rolesRemoved', { roles: res.removed.map((id) => `<@&${id}>`).join(', ') });
      }
    } catch (err) {
      console.error('[unlink] resync:', err);
      rolesNote = t('unlink.resyncFail');
    }
    return interaction.editReply({ content: `${t('unlink.done', { n: toRemove.length, user: `<@${target.id}>` })}${rolesNote}`, allowedMentions: { parse: [] } });
  },
};
