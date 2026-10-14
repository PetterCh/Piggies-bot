const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } = require('discord.js');
const NftPrize = require('../../models/NftPrize');
const WalletLink = require('../../models/WalletLink');
const { normalizeAddress } = require('../../utils/blockchain');
const { audit } = require('../../utils/adminLog');
const { t: tr, langForUser } = require('../../utils/i18n');
const { UserError, escapeRegex } = require('../../utils/helpers');
const config = require('../../config');
const { getGuildConfig, updateGuildConfig } = require('../../utils/guildConfig');
const { openBox } = require('../../services/lootbox');
const { publishLootboxPanel, removeLootboxPanel } = require('../../services/lootboxPanel');

const eph = { flags: MessageFlags.Ephemeral };
const isId = (s) => /^[a-f\d]{24}$/i.test(s);
const label = (p) => `${p.name}${p.contractAddress ? ` (${p.network} #${p.tokenId ?? '?'})` : ''}`;

module.exports = {
  // Botones del panel de cajas (públicos: los usa cualquier jugador). customId: lb:open:<caja>  ·  lb:again:<caja>:<userId>
  components: [
    {
      kind: 'button',
      prefix: 'lb',
      async execute(interaction, args) {
        const [action, boxId, ownerId] = args;
        if (action === 'open') return openBox(interaction, boxId, { ephemeral: config.lootbox.ephemeral });
        // "abrir otra": solo quien abrió la caja. Si el mensaje es privado, sigue siendo privado.
        if (interaction.user.id !== ownerId) return interaction.reply({ content: interaction.t('lootbox.notYours'), ...eph });
        return openBox(interaction, boxId, { again: true, ephemeral: !!interaction.message.flags?.has(MessageFlags.Ephemeral) });
      },
    },
  ],
  adminOnly: true, // la comprobación real vive en events/interactionCreate.js
  data: new SlashCommandBuilder()
    .setName('lootbox-admin')
    .setDescription('(Admin) Panel de cajas y NFT que se entregan como premio')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('panel').setDescription('Publica o actualiza el panel interactivo de cajas')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal del panel (vacío = el actual)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption((o) => o.setName('imagen').setDescription('URL https del arte del panel'))
      .addBooleanOption((o) => o.setName('quitar-imagen').setDescription('Quita la imagen personalizada'))
      .addBooleanOption((o) => o.setName('desactivar').setDescription('Borra el panel del canal')))
    .addSubcommand((s) => s.setName('nft-agregar').setDescription('Carga un NFT como premio (1 registro = 1 NFT)')
      .addStringOption((o) => o.setName('nombre').setDescription('Nombre del premio').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('contrato').setDescription('Contrato del NFT (opcional, informativo)'))
      .addStringOption((o) => o.setName('token-id').setDescription('Token ID (opcional)'))
      .addStringOption((o) => o.setName('red').setDescription('Red').addChoices({ name: 'EVM', value: 'EVM' }, { name: 'Ronin', value: 'RONIN' }))
      .addStringOption((o) => o.setName('imagen').setDescription('URL de la imagen (https://...)'))
      .addStringOption((o) => o.setName('descripcion').setDescription('Descripción').setMaxLength(200))
      .addBooleanOption((o) => o.setName('alto-valor').setDescription('Hacer @everyone al ganarlo (por defecto sí)')))
    .addSubcommand((s) => s.setName('nft-listar').setDescription('Lista los NFT premio')
      .addStringOption((o) => o.setName('estado').setDescription('Filtrar').addChoices({ name: 'Disponibles', value: 'available' }, { name: 'Ganados (por entregar)', value: 'won' }, { name: 'Entregados', value: 'delivered' })))
    .addSubcommand((s) => s.setName('nft-quitar').setDescription('Quita un NFT disponible del pool')
      .addStringOption((o) => o.setName('premio').setDescription('NFT disponible').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('nft-pendientes').setDescription('NFT ganados que faltan por entregar (con las wallets del ganador)'))
    .addSubcommand((s) => s.setName('nft-entregar').setDescription('Marca un NFT como entregado y avisa al ganador')
      .addStringOption((o) => o.setName('premio').setDescription('NFT ganado').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('tx').setDescription('Hash de la transacción de envío (opcional)'))),

  async autocomplete(interaction) {
    const status = interaction.options.getSubcommand() === 'nft-quitar' ? 'available' : 'won';
    const q = String(interaction.options.getFocused());
    const list = await NftPrize.find({ guildId: interaction.guildId, status, name: new RegExp(escapeRegex(q), 'i') }).limit(25).lean();
    await interaction.respond(list.map((p) => ({ name: label(p).slice(0, 100), value: String(p._id) })));
  },

  async execute(interaction) {
    const t = interaction.t;
    await interaction.deferReply(eph);
    const guildId = interaction.guildId;

    try {
      switch (interaction.options.getSubcommand()) {
        case 'panel': {
          if (interaction.options.getBoolean('desactivar')) {
            await removeLootboxPanel(interaction.client, guildId);
            await audit({ guildId, action: 'lootbox_panel_off', byId: interaction.user.id });
            return interaction.editReply(t('lootboxPanel.removed'));
          }
          const image = interaction.options.getString('imagen')?.trim();
          if (image && !/^https:\/\/\S{4,480}$/i.test(image)) throw new UserError(t('lootboxPanel.badImage'));
          if (image || interaction.options.getBoolean('quitar-imagen')) await updateGuildConfig(guildId, { $set: { lootboxPanelImage: image || null } });
          const channel = interaction.options.getChannel('canal');
          const cfg = await getGuildConfig(guildId);
          const targetId = channel?.id || cfg.lootboxPanelChannelId || interaction.channelId;
          const msg = await publishLootboxPanel(interaction.client, guildId, targetId);
          if (!msg) throw new UserError(t('lootboxPanel.noPerms', { channel: `<#${targetId}>` }));
          await audit({ guildId, action: 'lootbox_panel_set', byId: interaction.user.id, details: { channelId: targetId, image: image || null } });
          return interaction.editReply(t('lootboxPanel.published', { url: msg.url }));
        }
        case 'nft-agregar': {
          const contractRaw = interaction.options.getString('contrato');
          const contract = contractRaw ? normalizeAddress(contractRaw) : null;
          if (contractRaw && !contract) throw new UserError(t('nft.addrInvalid'));
          const image = interaction.options.getString('imagen');
          if (image && !/^https:\/\//i.test(image)) throw new UserError(t('lootboxAdmin.badImage'));
          const p = await NftPrize.create({
            guildId, name: interaction.options.getString('nombre', true), description: interaction.options.getString('descripcion') || '',
            imageUrl: image, network: interaction.options.getString('red') || 'EVM', contractAddress: contract, tokenId: interaction.options.getString('token-id'), highValue: interaction.options.getBoolean('alto-valor') ?? true,
          });
          await audit({ guildId, action: 'nft_prize_add', byId: interaction.user.id, details: { id: p._id, name: p.name } });
          return interaction.editReply(t('lootboxAdmin.added', { name: label(p) }));
        }
        case 'nft-listar': {
          const status = interaction.options.getString('estado');
          const list = await NftPrize.find({ guildId, ...(status ? { status } : {}) }).sort({ createdAt: 1 }).limit(40).lean();
          if (!list.length) return interaction.editReply(t('lootboxAdmin.empty'));
          const lines = list.map((p) => `• \`${String(p._id).slice(-5)}\` **${label(p)}** — ${t(`lootboxAdmin.status.${p.status}`)}${p.wonBy ? ` → <@${p.wonBy}>` : ''}`);
          return interaction.editReply({ content: lines.join('\n').slice(0, 1900), allowedMentions: { parse: [] } });
        }
        case 'nft-quitar': {
          const id = interaction.options.getString('premio', true);
          const p = isId(id) ? await NftPrize.findOneAndDelete({ _id: id, guildId, status: 'available' }) : null;
          if (!p) throw new UserError(t('lootboxAdmin.notFound'));
          await audit({ guildId, action: 'nft_prize_remove', byId: interaction.user.id, details: { id, name: p.name } });
          return interaction.editReply(t('lootboxAdmin.removed', { name: p.name }));
        }
        case 'nft-pendientes': {
          const list = await NftPrize.find({ guildId, status: 'won' }).sort({ wonAt: 1 }).limit(10).lean();
          if (!list.length) return interaction.editReply(t('lootboxAdmin.noPending'));
          const embed = new EmbedBuilder().setColor(0xff3df2).setTitle(t('lootboxAdmin.pendingTitle'));
          for (const p of list) {
            const wallets = (await WalletLink.find({ discordId: p.wonBy }).lean()).map((w) => `\`${w.address}\``).join('\n') || t('lootboxAdmin.noWallet');
            embed.addFields({ name: `${label(p)} · ${String(p._id).slice(-5)}`, value: `<@${p.wonBy}>\n${wallets}` });
          }
          return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
        }
        case 'nft-entregar': {
          const id = interaction.options.getString('premio', true);
          const p = isId(id)
            ? await NftPrize.findOneAndUpdate({ _id: id, guildId, status: 'won' }, { status: 'delivered', deliveredBy: interaction.user.id, deliveredAt: new Date(), txHash: interaction.options.getString('tx') }, { new: true })
            : null;
          if (!p) throw new UserError(t('lootboxAdmin.notFound'));
          await audit({ guildId, action: 'nft_prize_deliver', byId: interaction.user.id, targetId: p.wonBy, details: { id, name: p.name, tx: p.txHash } });
          const user = await interaction.client.users.fetch(p.wonBy).catch(() => null);
          const L = await langForUser(p.wonBy);
          await user?.send(tr(L, 'lootboxAdmin.dmDelivered', { name: p.name, server: interaction.guild.name })).catch(() => {});
          return interaction.editReply({ content: t('lootboxAdmin.delivered', { name: p.name, user: `<@${p.wonBy}>` }), allowedMentions: { parse: [] } });
        }
      }
    } catch (err) {
      if (err instanceof UserError) return interaction.editReply(`❌ ${err.message}`);
      throw err;
    }
  },
};
