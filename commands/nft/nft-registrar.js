const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const NftCollection = require('../../models/NftCollection');
const { normalizeAddress, verifyContract, ANY_VALUE } = require('../../utils/blockchain');
const { syncGuild, getGuildCollections } = require('../../services/nftSync');
const tokenRoles = require('../../services/tokenRoles');
const tokenOwners = require('../../services/tokenOwners');
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
    .addSubcommand((s) => s.setName('token-roles').setDescription('Muestra los roles por Token ID (JSON externo) y si están bien configurados'))
    .addSubcommand((s) => s.setName('tokens-importar').setDescription('Carga el índice interno token→wallet desde un archivo CSV/JSON (sin usar la blockchain)')
      .addStringOption((o) => o.setName('coleccion').setDescription('Nombre o contrato de la colección').setRequired(true))
      .addAttachmentOption((o) => o.setName('archivo').setDescription('CSV (token_id,wallet) o JSON con los dueños actuales').setRequired(true)))
    .addSubcommand((s) => s.setName('tokens-actualizar').setDescription('Refresca el índice leyendo la cadena MUY despacio (solo los IDs de los grupos)')
      .addStringOption((o) => o.setName('coleccion').setDescription('Nombre o contrato de la colección').setRequired(true)))
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
        case 'token-roles': {
          const cols = await getGuildCollections(guild.id);
          const { groups } = tokenRoles.loadGroups();
          const { resolved, problems } = tokenRoles.resolveGroups(cols);
          const ok = new Set(resolved.map((g) => g.ref));
          const cover = new Map();
          for (const g of resolved) {
            const owners = await tokenOwners.ownersFor(g.col, g.tokenIds);
            const last = Math.max(0, ...[...owners.values()].map((x) => new Date(x.updatedAt).getTime() || 0));
            cover.set(g.ref, { have: owners.size, total: g.tokenIds.length, last });
          }
          const lines = groups.map((g) => {
            const role = guild.roles.cache.get(g.roleId);
            const state = !ok.has(g.ref) ? '⚠️' : role?.editable ? '✅' : '❌';
            return `${state} **${g.ref}** · ${g.collection || '—'} · ${t('nft.tokenRoles.count', { n: g.tokenIds.length })} → ${role ? `<@&${role.id}>` : `\`${g.roleId}\` ${t('nft.tokenRoles.noRole')}`}${role && !role.editable ? ` (${t('nft.tokenRoles.hierarchy')})` : ''}${cover.has(g.ref) ? `\n　${t('nft.tokenRoles.index', { have: cover.get(g.ref).have, total: cover.get(g.ref).total })}${cover.get(g.ref).last ? ` · <t:${Math.floor(cover.get(g.ref).last / 1000)}:R>` : ''}` : ''}`;
          });
          const embed = new EmbedBuilder().setTitle(t('nft.tokenRoles.title')).setColor(0x5865f2)
            .setDescription((lines.join('\n') || t('nft.tokenRoles.none')).slice(0, 3900));
          if (problems.length) embed.addFields({ name: t('nft.tokenRoles.problems'), value: problems.map((x) => `• ${x}`).join('\n').slice(0, 1000) });
          embed.setFooter({ text: t('nft.tokenRoles.footer') });
          return interaction.editReply({ embeds: [embed] });
        }
        case 'tokens-importar': {
          const col = await findCollection(t, guild.id, interaction.options.getString('coleccion', true));
          const file = interaction.options.getAttachment('archivo', true);
          if (file.size > 2 * 1024 * 1024) throw new UserError(t('nft.tokenOwners.tooBig'));
          let parsed;
          try {
            const res = await fetch(file.url, { signal: AbortSignal.timeout(15_000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            parsed = tokenOwners.parseSnapshot(await res.text());
          } catch (err) {
            throw new UserError(t('nft.tokenOwners.fileFail', { error: err.message }));
          }
          if (!parsed.rows.length) throw new UserError(t('nft.tokenOwners.empty'));
          const n = await tokenOwners.saveRows(col, parsed.rows, 'import');
          const wanted = new Set(tokenRoles.resolveGroups(await getGuildCollections(guild.id)).resolved.filter((g) => g.col.id === col.id).flatMap((g) => g.tokenIds));
          const covered = parsed.rows.filter((r) => wanted.has(r.tokenId)).length;
          return interaction.editReply(t('nft.tokenOwners.imported', { n, name: col.name, covered, wanted: wanted.size })
            + (parsed.bad.length ? `\n${t('nft.tokenOwners.bad', { n: parsed.bad.length, sample: parsed.bad.slice(0, 3).join(' | ') })}` : ''));
        }
        case 'tokens-actualizar': {
          const col = await findCollection(t, guild.id, interaction.options.getString('coleccion', true));
          const ids = tokenRoles.resolveGroups(await getGuildCollections(guild.id)).resolved.filter((g) => g.col.id === col.id).flatMap((g) => g.tokenIds);
          if (!ids.length) throw new UserError(t('nft.tokenOwners.noGroups', { name: col.name }));
          await interaction.editReply(t('nft.tokenOwners.refreshing', { n: new Set(ids).size }));
          const r = await tokenOwners.refreshFromChain(col, ids, {
            onProgress: (done, total) => interaction.editReply(t('nft.tokenOwners.progress', { done, total })),
          });
          return interaction.editReply(t(r.aborted ? 'nft.tokenOwners.aborted' : 'nft.tokenOwners.refreshed', { ok: r.ok, failed: r.failed }));
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
