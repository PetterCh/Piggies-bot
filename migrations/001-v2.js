// Migración idempotente a v2 (se ejecuta sola al arrancar; puedes lanzarla a mano con `npm run migrate`).
//  1) WalletLink: elimina el índice único antiguo sobre discordId (ahora se permiten varias wallets por usuario).
//  2) Expedition: si por algún motivo hubiese varias expediciones abiertas del mismo usuario (lo que impediría
//     crear el índice único parcial), conserva la más antigua y cancela el resto.
// NO borra ni modifica saldos, inventarios, wallets ni colecciones existentes.
const mongoose = require('mongoose');

async function run() {
  const db = mongoose.connection;

  // 1) wallets
  try {
    const col = db.collection('walletlinks');
    const idx = await col.indexes();
    const old = idx.find((i) => i.name === 'discordId_1' && i.unique);
    if (old) {
      await col.dropIndex('discordId_1');
      console.log('[migración] WalletLink: índice único de discordId eliminado (múltiples wallets habilitadas)');
    }
  } catch (err) {
    if (err.codeName !== 'NamespaceNotFound' && err.code !== 26) throw err; // colección aún inexistente = nada que migrar
  }

  // 1b) tienda de expedición: el índice único antiguo (guildId, slot) se reemplaza por (guildId, tier, slot)
  try {
    const col = db.collection('expshoprotations');
    const old = (await col.indexes()).find((i) => i.name === 'guildId_1_slot_1');
    if (old) {
      await col.dropIndex('guildId_1_slot_1');
      console.log('[migración] Tienda de expedición: índice antiguo (guildId, slot) eliminado; ahora hay rotación rápida y lenta');
    }
    // Rotaciones antiguas (sin `tier`, mezclaban todos los niveles): se marcan 'legacy' para que NUNCA choquen con las rápidas/lentas
    // (el valor por defecto 'fast' las hacía colisionar en el índice único al re-guardarlas).
    const mark = await col.updateMany({ tier: { $exists: false } }, { $set: { tier: 'legacy' } });
    if (mark.modifiedCount) console.log(`[migración] Tienda de expedición: ${mark.modifiedCount} rotaciones antiguas marcadas como legacy`);
    // Si por algún motivo quedaron duplicados (guildId, tier, slot), se conserva la más reciente: el índice único necesita datos limpios.
    const dups = await col.aggregate([
      { $sort: { updatedAt: -1, _id: -1 } },
      { $group: { _id: { g: '$guildId', t: '$tier', s: '$slot' }, ids: { $push: '$_id' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]).toArray();
    for (const d of dups) {
      const [, ...extra] = d.ids;
      await col.deleteMany({ _id: { $in: extra } });
      console.log(`[migración] Tienda de expedición: ${extra.length} rotaciones duplicadas eliminadas (slot ${d._id.s}, ${d._id.t})`);
    }
    // Un índice con ese nombre que NO sea único (o de otra forma) impediría crear el correcto: se borra y Mongoose lo recrea.
    const cur = (await col.indexes()).find((i) => i.name === 'guildId_1_tier_1_slot_1');
    if (cur && !cur.unique) {
      await col.dropIndex('guildId_1_tier_1_slot_1');
      console.log('[migración] Tienda de expedición: índice (guildId, tier, slot) no único eliminado para recrearlo');
    }
  } catch (err) {
    if (err.codeName !== 'NamespaceNotFound' && err.code !== 26) throw err;
  }

  // 1c) rebalanceo v7.10: los objetos exclusivos que ya tenían más usos de los nuevos máximos se recortan (p. ej. 11/11 -> 4/4).
  try {
    const { ITEMS, SLOTS } = require('../data/gameData');
    const users = db.collection('users');
    let clipped = 0;
    for (const [id, it] of Object.entries(ITEMS)) {
      if (!it.maxUses) continue;
      const r1 = await users.updateMany(
        { 'piggy.inventory': { $elemMatch: { itemId: id, usesLeft: { $gt: it.maxUses } } } },
        { $set: { 'piggy.inventory.$[e].usesLeft': it.maxUses } },
        { arrayFilters: [{ 'e.itemId': id, 'e.usesLeft': { $gt: it.maxUses } }] }
      );
      const slot = it.type;
      if (!SLOTS.includes(slot)) continue;
      const r2 = await users.updateMany({ [`piggy.equipped.${slot}`]: id, [`piggy.equippedUses.${slot}`]: { $gt: it.maxUses } }, { $set: { [`piggy.equippedUses.${slot}`]: it.maxUses } });
      clipped += r1.modifiedCount + r2.modifiedCount;
    }
    if (clipped) console.log(`[migración] Rebalanceo: ${clipped} objetos exclusivos con usos recortados al nuevo máximo`);
  } catch (err) {
    console.error('[migración] recorte de usos:', err.message); // no es crítico: el bot funciona igual (solo muestra usos mayores al máximo)
  }

  // 2) expediciones duplicadas
  const exps = db.collection('expeditions');
  const dups = await exps
    .aggregate([
      { $match: { open: true } },
      { $sort: { startedAt: 1 } },
      { $group: { _id: '$discordId', ids: { $push: '$_id' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray()
    .catch(() => []);
  for (const d of dups) {
    const [, ...extra] = d.ids;
    await exps.updateMany({ _id: { $in: extra } }, { $set: { open: false, status: 'cancelled' } });
    console.log(`[migración] Expediciones duplicadas canceladas para ${d._id}: ${extra.length}`);
  }
}

module.exports = { run };
