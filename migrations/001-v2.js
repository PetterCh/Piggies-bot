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
