// Sincroniza roles de Discord con lo que cada usuario posee on-chain.
// v2: un usuario puede tener VARIAS wallets; sus roles son la unión de lo que posean todas.
const NftCollection = require('../models/NftCollection');
const WalletLink = require('../models/WalletLink');
const config = require('../config');
const { getHoldings, norm, ANY_VALUE, hasEmptyValue } = require('../utils/blockchain');
const { mapLimit } = require('../utils/helpers');
const tokenRoles = require('./tokenRoles');

const getGuildCollections = (guildId) => NftCollection.find({ guildId, active: true });

function getManagedRoleIds(collections) {
  const ids = new Set();
  for (const c of collections) {
    if (c.holderRoleId) ids.add(c.holderRoleId);
    for (const t of c.traitRoles) ids.add(t.roleId);
  }
  for (const id of tokenRoles.managedRoleIds(collections)) ids.add(id); // roles por token ID (JSON externo)
  return ids;
}

/**
 * ¿Este NFT cumple la regla? Dos formas:
 *  - rasgo exacto (value = "Gold"): el NFT tiene traitType = Gold.
 *  - CATEGORÍA (value = ANY_VALUE): el NFT tiene ese traitType con cualquier valor real (se ignoran "none", "n/a"…).
 */
function matchesRule(rule, attrs) {
  const v = attrs[norm(rule.traitType)];
  if (v === undefined) return false;
  if (rule.value === ANY_VALUE) return !hasEmptyValue(v);
  return v === norm(rule.value);
}

/**
 * Roles que corresponden a un conjunto de wallets. `failed` = roles de colecciones cuya lectura falló
 * (RPC caído...): esos roles NUNCA se quitan para no dejar sin roles a todos por un fallo temporal.
 */
async function evaluateWallets(collections, addresses) {
  const desired = new Set();
  const failed = new Set();

  for (const address of addresses) {
    for (const col of collections) {
      const needTraits = col.traitRoles.length > 0;
      try {
        const { count, tokens } = await getHoldings(col, address, needTraits);
        if (count > 0 && col.holderRoleId) desired.add(col.holderRoleId);
        for (const rule of col.traitRoles) {
          if (tokens.some((t) => matchesRule(rule, t.attrs))) desired.add(rule.roleId);
        }
      } catch (err) {
        console.error(`[nft] Falló ${col.name} para ${address}: ${err.shortMessage || err.message}`);
        if (col.holderRoleId) failed.add(col.holderRoleId);
        col.traitRoles.forEach((t) => failed.add(t.roleId));
      }
    }
  }
  // Roles por token ID concreto (JSON externo): se SUMAN a los de holder y rasgo, nunca los reemplazan.
  const byToken = await tokenRoles.evaluateTokenRoles(collections, addresses);
  byToken.desired.forEach((r) => desired.add(r));
  byToken.failed.forEach((r) => failed.add(r));
  return { desired, failed };
}

async function applyRoles(member, desired, managed, failed) {
  const usable = (id) => member.guild.roles.cache.get(id)?.editable === true;
  const current = member.roles.cache;
  const toAdd = [...desired].filter((id) => !current.has(id) && usable(id));
  const toRemove = [...managed].filter((id) => current.has(id) && !desired.has(id) && !failed.has(id) && usable(id));
  if (toAdd.length) await member.roles.add(toAdd, 'NFT sync: holder verificado');
  if (toRemove.length) await member.roles.remove(toRemove, 'NFT sync: ya no posee el NFT/rasgo');
  return { added: toAdd, removed: toRemove };
}

/** Sincroniza a un miembro con TODAS las wallets que se le pasen (array de direcciones; puede estar vacío). */
async function syncMember(guild, member, addresses, collections) {
  const managed = getManagedRoleIds(collections);
  const { desired, failed } = await evaluateWallets(collections, addresses);
  return applyRoles(member, desired, managed, failed);
}

const walletsOf = async (discordId) => (await WalletLink.find({ discordId }).lean()).map((l) => l.address);

async function syncGuild(guild) {
  const stats = { checked: 0, added: 0, removed: 0, errors: 0 };
  const collections = await getGuildCollections(guild.id);
  if (!collections.length) return stats;

  const managed = getManagedRoleIds(collections);
  await guild.members.fetch(); // requiere el intent privilegiado "Server Members"

  // Agrupa las wallets por usuario (solo los que siguen en el servidor).
  const byUser = new Map();
  for (const l of await WalletLink.find().lean()) {
    if (!guild.members.cache.has(l.discordId)) continue;
    if (!byUser.has(l.discordId)) byUser.set(l.discordId, []);
    byUser.get(l.discordId).push(l.address);
  }

  await mapLimit([...byUser], config.nft.walletConcurrency, async ([discordId, addresses]) => {
    try {
      const member = guild.members.cache.get(discordId);
      const { desired, failed } = await evaluateWallets(collections, addresses);
      const res = await applyRoles(member, desired, managed, failed);
      stats.checked++;
      stats.added += res.added.length;
      stats.removed += res.removed.length;
    } catch (err) {
      stats.errors++;
      console.error(`[nft] Error con ${discordId}:`, err.message);
    }
  });
  return stats;
}

let running = false;
async function syncAllGuilds(client) {
  if (running) return console.warn('[nft] Sincronización previa aún en curso, se omite.');
  running = true;
  const started = Date.now();
  try {
    for (const guild of client.guilds.cache.values()) {
      const s = await syncGuild(guild);
      console.log(`[nft] ${guild.name}: ${s.checked} usuarios, +${s.added} / -${s.removed} roles, ${s.errors} errores`);
    }
    console.log(`[nft] Sincronización terminada en ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    running = false;
  }
}

module.exports = { matchesRule, evaluateWallets, getGuildCollections, syncMember, syncGuild, syncAllGuilds, walletsOf };
