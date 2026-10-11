const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const NftCollection = require('../../models/NftCollection');
const { normalizeAddress, verifyContract, ANY_VALUE } = require('../../utils/blockchain');
const { syncGuild } = require('../../services/nftSync');
const { UserError, escapeRegex } = require('../../utils/helpers');

function assertRoleUsable(t, guild, role) {
  const r = guild.roles.cache.get(role.id);
  if (!r || r.managed || r.id === guild.id) throw new UserError(t('nft.roleInvalid', { role: `${role}` }));
  if (!r.editable) throw new UserError(t('nft.roleHierarchy', { role: `${role}` }));
}

async function findCollection(t, guildId, query) {
  const address = normalizeAddress(query);
  const filter = address ? { guildId, contractAddress: address } : { guildId, nameKey: new RegExp(`^${escapeRegex(query.trim())}$`, 'i') };
  const col = await NftCollection.findOne(filter);
  if (!col) throw new UserError(t('nft.notFound'));
  return col;
}

module.exports = {
  adminOnly: true, // la comprobación real vive en events/interactionCreate.js
  data: new SlashCommandBuilder()
    .setName('nft-registrar')
    .setDescription('Administra las colecciones NFT que otorgan roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s.setName('coleccion').setDescription('Registra una colección y el rol por ser holder')
        .addStringOption((o) => o.setName('nombre').setDescription('Nombre interno de la colección').setRequired(true).setMaxLength(50))
        .addStringOption((o) => o.setName('contrato').setDescription('Dirección del contrato (0x… o ronin:…)').setRequired(true))
        .addStringOption((o) => o.setName('red').setDescription('Red del contrato').setRequired(true).addChoices({ name: 'EVM (Ethereum, Polygon, etc.)', value: 'EVM' }, { name: 'Ronin', value: 'RONIN' }))
        .addRoleOption((o) => o.setName('rol-holder').setDescription('Rol para quien tenga al menos 1 NFT'))
        .addStringOption((o) => o.setName('rpc').setDescription('RPC propio (si no, se usa el de la red en .env)'))
    )
    .addSubcommand((s) =>
      s.setName('rasgo').setDescription('Rol por rasgo (trait) o por CATEGORÍA completa de rasgos')
        .addStringOption((o) => o.setName('coleccion').setDescription('Nombre o contrato de la colección').setRequired(true))
        .addStringOption((o) => o.setName('tipo').setDescription('Tipo/categoría del rasgo, ej: Background o Special').setRequired(true))
        .addRoleOption((o) => o.setName('rol').setDescription('Rol que se otorga').setRequired(true))
        .addStringOption((o) => o.setName('valor').setDescription('Valor exacto, ej: Gold (vacío = CUALQUIER valor de esa categoría)'))
    )
    .addSubcommand((s) => s.setName('listar').setDescription('Muestra las colecciones registradas'))
    .addSubcommand((s) => s.setName('eliminar').setDescription('Elimina una colección (los roles ya otorgados NO se quitan)')
      .addStringOption((o) => o.setName('coleccion').setDescription('Nombre o contrato').setRequired(true)))
    .addSubcommand((s) => s.setName('sincronizar').setDescription('Fuerza ahora la sincronización de roles de este servidor')),

  async execute(interaction) {
    const t = interaction.t;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;

    try {
      switch (interaction.options.getSubcommand()) {
        case 'coleccion': {
          const name = interaction.options.getString('nombre', true).trim();
          const address = normalizeAddress(interaction.options.getString('contrato', true));
          const network = interaction.options.getString('red', true);
          const role = interaction.options.getRole('rol-holder');
          const rpc = interaction.options.getString('rpc');
          if (!address) throw new UserError(t('nft.addrInvalid'));
          if (rpc && !/^https?:\/\//i.test(rpc)) throw new UserError(t('nft.rpcInvalid'));
          if (role) assertRoleUsable(t, guild, role);
          await verifyContract(network, address, rpc).catch((err) => {
            throw new UserError(t('nft.verifyFail', { network, error: err.shortMessage || err.message }));
          });
          try {
            await NftCollection.create({ guildId: guild.id, name, nameKey: name.toLowerCase(), contractAddress: address, network, rpcUrl: rpc, holderRoleId: role?.id ?? null });
          } catch (err) {
            if (err.code === 11000) throw new UserError(t('nft.exists'));
            throw err;
          }
          return interaction.editReply(t('nft.registered', { name, address, network, holder: role ? t('nft.holderLine', { role: `${role}` }) : '' }));
        }
        case 'rasgo': {
          const col = await findCollection(t, guild.id, interaction.options.getString('coleccion', true));
          const traitType = interaction.options.getString('tipo', true).trim();
          // Sin `valor` (o con "*") la regla es de CATEGORÍA: cualquier NFT con ese tipo de rasgo recibe el rol.
          const rawValue = interaction.options.getString('valor')?.trim();
          const isCategory = !rawValue || rawValue === ANY_VALUE;
          const value = isCategory ? ANY_VALUE : rawValue;
          const role = interaction.options.getRole('rol', true);
          assertRoleUsable(t, guild, role);
          // Una regla por (tipo, valor): repetir el comando con el mismo par solo cambia el rol. El rol de Holder NO se toca.
          col.traitRoles = col.traitRoles.filter((x) => !(x.traitType.toLowerCase() === traitType.toLowerCase() && x.value.toLowerCase() === value.toLowerCase()));
          col.traitRoles.push({ traitType, value, roleId: role.id });
          await col.save();
          return interaction.editReply(t(isCategory ? 'nft.categorySaved' : 'nft.traitSaved', { name: col.name, trait: traitType, value, role: `${role}` }));
        }
        case 'listar': {
          const cols = await NftCollection.find({ guildId: guild.id }).sort({ createdAt: 1 });
          if (!cols.length) return interaction.editReply(t('nft.empty'));
          const embed = new EmbedBuilder().setTitle(t('nft.listTitle')).setColor(0x5865f2);
          for (const c of cols.slice(0, 25)) {
            const traits = c.traitRoles.map((x) => (x.value === ANY_VALUE ? `• ${t('nft.anyValue', { trait: x.traitType })} → <@&${x.roleId}>` : `• ${x.traitType} = ${x.value} → <@&${x.roleId}>`)).join('\n') || '—';
            embed.addFields({ name: `${c.name} (${c.network})`, value: `\`${c.contractAddress}\`\n${t('nft.holderLabel')}: ${c.holderRoleId ? `<@&${c.holderRoleId}>` : '—'}\n${traits}`.slice(0, 1000) });
          }
          return interaction.editReply({ embeds: [embed] });
        }
        case 'eliminar': {
          const col = await findCollection(t, guild.id, interaction.options.getString('coleccion', true));
          await col.deleteOne();
          return interaction.editReply(t('nft.deleted', { name: col.name }));
        }
        case 'sincronizar': {
          await interaction.editReply(t('nft.syncing'));
          const s = await syncGuild(guild);
          return interaction.editReply(t('nft.synced', { checked: s.checked, added: s.added, removed: s.removed, errors: s.errors }));
        }
      }
    } catch (err) {
      if (err instanceof UserError) return interaction.editReply(`❌ ${err.message}`);
      throw err;
    }
  },
};
