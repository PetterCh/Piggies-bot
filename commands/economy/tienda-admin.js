const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const ShopItem = require('../../models/ShopItem');
const ShopPurchase = require('../../models/ShopPurchase');
const config = require('../../config');
const { addCoinks } = require('../../utils/economy');
const { audit } = require('../../utils/adminLog');
const { normalizeAddress } = require('../../utils/blockchain');
const { getGuildConfig } = require('../../utils/guildConfig');
const { queueSync, syncAll } = require('../../services/storeSync');
const { t: tr, langForUser } = require('../../utils/i18n');
const { UserError, escapeRegex, fmt } = require('../../utils/helpers');

const eph = { flags: MessageFlags.Ephemeral };
const isId = (s) => /^[a-f\d]{24}$/i.test(s);

module.exports = {
  adminOnly: true, // la comprobación real vive en events/interactionCreate.js
  data: new SlashCommandBuilder()
    .setName('tienda-admin')
    .setDescription('(Admin) Gestiona la tienda del servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('agregar').setDescription('Pone un artículo a la venta')
      .addStringOption((o) => o.setName('nombre').setDescription('Nombre del artículo').setRequired(true).setMaxLength(60))
      .addIntegerOption((o) => o.setName('precio').setDescription('Precio en Coinks').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000))
      .addStringOption((o) => o.setName('tipo').setDescription('Cómo se entrega').setRequired(true).addChoices({ name: 'Rol (automático)', value: 'role' }, { name: 'Manual (un admin lo entrega)', value: 'manual' }, { name: 'NFT (envío manual, exige wallet vinculada)', value: 'nft' }))
      .addRoleOption((o) => o.setName('rol').setDescription('Rol a entregar (si el tipo es Rol)'))
      .addIntegerOption((o) => o.setName('stock').setDescription('Unidades disponibles (vacío = ilimitado)').setMinValue(1))
      .addIntegerOption((o) => o.setName('max-por-usuario').setDescription('Máximo por persona (vacío = sin límite)').setMinValue(1))
      .addStringOption((o) => o.setName('descripcion').setDescription('Descripción').setMaxLength(200))
      .addStringOption((o) => o.setName('imagen').setDescription('URL https de la imagen de la tarjeta'))
      .addStringOption((o) => o.setName('contrato').setDescription('NFT: contrato (informativo)'))
      .addStringOption((o) => o.setName('token-id').setDescription('NFT: token ID (informativo)'))
      .addStringOption((o) => o.setName('red').setDescription('NFT: red').addChoices({ name: 'EVM', value: 'EVM' }, { name: 'Ronin', value: 'RONIN' })))
    .addSubcommand((s) => s.setName('editar').setDescription('Cambia precio, stock o disponibilidad')
      .addStringOption((o) => o.setName('articulo').setDescription('Artículo').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('precio').setDescription('Nuevo precio').setMinValue(1).setMaxValue(1_000_000_000))
      .addIntegerOption((o) => o.setName('stock').setDescription('Nuevo stock').setMinValue(0))
      .addBooleanOption((o) => o.setName('ilimitado').setDescription('Stock ilimitado'))
      .addBooleanOption((o) => o.setName('activo').setDescription('Mostrar/ocultar en la tienda'))
      .addStringOption((o) => o.setName('descripcion').setDescription('Nueva descripción').setMaxLength(200))
      .addStringOption((o) => o.setName('imagen').setDescription('Nueva imagen https (o - para quitarla)')))
    .addSubcommand((s) => s.setName('pedidos').setDescription('Lista los pedidos manuales pendientes'))
    .addSubcommand((s) => s.setName('refrescar').setDescription('Vuelve a publicar la tienda completa en su canal'))
    .addSubcommand((s) => s.setName('entregar').setDescription('Marca un pedido como entregado y avisa al comprador')
      .addStringOption((o) => o.setName('pedido').setDescription('Pedido pendiente').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('tx').setDescription('Hash de la transacción de envío (NFT, opcional)')))
    .addSubcommand((s) => s.setName('reembolsar').setDescription('Cancela un pedido pendiente y devuelve los Coinks')
      .addStringOption((o) => o.setName('pedido').setDescription('Pedido pendiente').setRequired(true).setAutocomplete(true))),

  async autocomplete(interaction) {
    const focus = interaction.options.getFocused(true);
    const q = String(focus.value || '');
    if (focus.name === 'articulo') {
      const items = await ShopItem.find({ guildId: interaction.guildId, name: new RegExp(escapeRegex(q), 'i') }).limit(25).lean();
      return interaction.respond(items.map((i) => ({ name: `${i.active ? '' : '(oculto) '}${i.name} — ${fmt(i.price)}`.slice(0, 100), value: String(i._id) })));
    }
    const orders = await ShopPurchase.find({ guildId: interaction.guildId, status: 'pending' }).sort({ createdAt: 1 }).limit(25).lean();
    return interaction.respond(orders.map((o) => ({ name: `#${String(o._id).slice(-5)} · ${o.itemName} · ${o.userId}`.slice(0, 100), value: String(o._id) })));
  },

  async execute(interaction) {
    const t = interaction.t;
    await interaction.deferReply(eph);
    const guildId = interaction.guildId;
    const cur = config.currency;

    try {
      switch (interaction.options.getSubcommand()) {
        case 'agregar': {
          const name = interaction.options.getString('nombre', true).trim();
          const type = interaction.options.getString('tipo', true);
          const role = interaction.options.getRole('rol');
          const image = interaction.options.getString('imagen');
          if (image && !/^https:\/\//i.test(image)) throw new UserError(t('shopAdmin.badImage'));
          const contractRaw = interaction.options.getString('contrato');
          const contract = contractRaw ? normalizeAddress(contractRaw) : null;
          if (contractRaw && !contract) throw new UserError(t('nft.addrInvalid'));
          if (type === 'role') {
            if (!role) throw new UserError(t('shopAdmin.needRole'));
            const r = interaction.guild.roles.cache.get(role.id);
            if (!r || r.managed || !r.editable) throw new UserError(t('nft.roleHierarchy', { role: `${role}` }));
          }
          try {
            const item = await ShopItem.create({
              guildId, name, nameKey: name.toLowerCase(), type, roleId: type === 'role' ? role.id : null,
              price: interaction.options.getInteger('precio', true),
              stock: interaction.options.getInteger('stock') ?? null,
              maxPerUser: interaction.options.getInteger('max-por-usuario') ?? 0,
              description: interaction.options.getString('descripcion') || '',
              imageUrl: image || null,
              nftContract: contract,
              nftTokenId: interaction.options.getString('token-id'),
              nftNetwork: interaction.options.getString('red'),
            });
            await audit({ guildId, action: 'shop_add', byId: interaction.user.id, details: { id: item._id, name, price: item.price } });
            queueSync(interaction.client, item._id, { announce: true }); // publica la tarjeta (y avisa al rol de novedades) si hay canal de tienda
            const cfg = await getGuildConfig(guildId);
            return interaction.editReply(t('shopAdmin.added', { name, price: fmt(item.price), emoji: cur.emoji }) + (cfg.storeChannelId ? '' : `\n${t('shopAdmin.noStoreChannel')}`));
          } catch (err) {
            if (err.code === 11000) throw new UserError(t('shopAdmin.exists'));
            throw err;
          }
        }
        case 'editar': {
          const id = interaction.options.getString('articulo', true);
          if (!isId(id)) throw new UserError(t('shop.notFound'));
          const set = {};
          const price = interaction.options.getInteger('precio');
          const stock = interaction.options.getInteger('stock');
          const unlimited = interaction.options.getBoolean('ilimitado');
          const active = interaction.options.getBoolean('activo');
          if (price !== null) set.price = price;
          if (stock !== null) set.stock = stock;
          if (unlimited) set.stock = null;
          if (active !== null) set.active = active;
          const desc = interaction.options.getString('descripcion');
          const img = interaction.options.getString('imagen');
          if (desc !== null) set.description = desc;
          if (img !== null) {
            if (img !== '-' && !/^https:\/\//i.test(img)) throw new UserError(t('shopAdmin.badImage'));
            set.imageUrl = img === '-' ? null : img;
          }
          if (!Object.keys(set).length) throw new UserError(t('shopAdmin.nothingToEdit'));
          const item = await ShopItem.findOneAndUpdate({ _id: id, guildId }, { $set: set }, { new: true });
          if (!item) throw new UserError(t('shop.notFound'));
          await audit({ guildId, action: 'shop_edit', byId: interaction.user.id, details: { id, set } });
          queueSync(interaction.client, item._id);
          return interaction.editReply(t('shopAdmin.edited', { name: item.name }));
        }
        case 'pedidos': {
          const orders = await ShopPurchase.find({ guildId, status: 'pending' }).sort({ createdAt: 1 }).limit(25).lean();
          if (!orders.length) return interaction.editReply(t('shopAdmin.noPending'));
          const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle(t('shopAdmin.pendingTitle'))
            .setDescription(orders.map((o) => `\`#${String(o._id).slice(-5)}\` · **${o.itemName}** · <@${o.userId}> · <t:${Math.floor(o.createdAt.getTime() / 1000)}:R>`).join('\n'));
          return interaction.editReply({ embeds: [embed] });
        }
        case 'refrescar': {
          await interaction.editReply(t('shopAdmin.refreshing'));
          const n = await syncAll(interaction.client, guildId);
          return interaction.editReply(t('shopAdmin.refreshed', { n }));
        }
        case 'entregar': {
          const id = interaction.options.getString('pedido', true);
          if (!isId(id)) throw new UserError(t('shopAdmin.orderNotFound'));
          const o = await ShopPurchase.findOneAndUpdate({ _id: id, guildId, status: 'pending' }, { status: 'delivered', deliveredBy: interaction.user.id, deliveredAt: new Date(), txHash: interaction.options.getString('tx') || null }, { new: true });
          if (!o) throw new UserError(t('shopAdmin.orderNotFound'));
          await audit({ guildId, action: 'shop_deliver', byId: interaction.user.id, targetId: o.userId, details: { id, item: o.itemName } });
          const user = await interaction.client.users.fetch(o.userId).catch(() => null);
          const L = await langForUser(o.userId);
          await user?.send(tr(L, o.txHash ? 'shopAdmin.dmDeliveredTx' : 'shopAdmin.dmDelivered', { item: o.itemName, server: interaction.guild.name, tx: o.txHash })).catch(() => {});
          return interaction.editReply({ content: t('shopAdmin.delivered', { item: o.itemName, user: `<@${o.userId}>` }), allowedMentions: { parse: [] } });
        }
        case 'reembolsar': {
          const id = interaction.options.getString('pedido', true);
          if (!isId(id)) throw new UserError(t('shopAdmin.orderNotFound'));
          const o = await ShopPurchase.findOneAndUpdate({ _id: id, guildId, status: 'pending' }, { status: 'refunded' }, { new: true });
          if (!o) throw new UserError(t('shopAdmin.orderNotFound'));
          await addCoinks(o.userId, o.price, { type: 'shop_refund', reason: o.itemName, guildId, byId: interaction.user.id });
          await ShopItem.updateOne({ _id: o.itemId, stock: { $ne: null } }, { $inc: { stock: 1 } }); // devuelve la unidad al stock limitado
          queueSync(interaction.client, o.itemId);
          await audit({ guildId, action: 'shop_refund', byId: interaction.user.id, targetId: o.userId, details: { id, item: o.itemName, price: o.price } });
          return interaction.editReply({ content: t('shopAdmin.refunded', { item: o.itemName, user: `<@${o.userId}>`, price: fmt(o.price), emoji: cur.emoji }), allowedMentions: { parse: [] } });
        }
      }
    } catch (err) {
      if (err instanceof UserError) return interaction.editReply(`❌ ${err.message}`);
      throw err;
    }
  },
};
