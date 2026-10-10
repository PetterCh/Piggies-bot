// Capa única de acceso a los Coinks. TODO movimiento de saldo debe pasar por aquí.
// Las operaciones son atómicas (un solo update en MongoDB) para evitar duplicar o gastar
// dos veces el mismo saldo con clics/comandos simultáneos.
const User = require('../models/User');
const Ledger = require('../models/Ledger');

class InsufficientFundsError extends Error {
  constructor(message = 'Fondos insuficientes') {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

function assertAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError('La cantidad debe ser un entero positivo.');
  }
}

/** Registra en el libro contable sin bloquear ni romper la operación si falla. */
function logLedger(entry) {
  return Ledger.create(entry).catch((err) => console.error('[ledger]', err));
}

/** Upsert con reintento: dos peticiones simultáneas que crean el mismo usuario provocan E11000. */
async function upsertUser(discordId, update) {
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  const body = { ...update, $setOnInsert: { ...(update.$setOnInsert || {}), discordId } };
  try {
    return await User.findOneAndUpdate({ discordId }, body, opts);
  } catch (err) {
    if (err.code === 11000) return User.findOneAndUpdate({ discordId }, body, opts);
    throw err;
  }
}

/** Devuelve el perfil del usuario, creándolo si no existe. */
const getUser = (discordId) => upsertUser(discordId, {});

// --- Primitivas sin registro contable (las usan las funciones públicas) ---
const _credit = (discordId, amount) => upsertUser(discordId, { $inc: { coinks: amount } });

async function _debit(discordId, amount) {
  // El filtro `coinks >= amount` hace la comprobación de saldo y el descuento en UNA sola operación.
  const user = await User.findOneAndUpdate(
    { discordId, coinks: { $gte: amount } },
    { $inc: { coinks: -amount } },
    { new: true }
  );
  if (!user) throw new InsufficientFundsError();
  return user;
}

/** Suma Coinks a un usuario. meta: { type, reason, guildId, byId } */
async function addCoinks(discordId, amount, meta = {}) {
  assertAmount(amount);
  const user = await _credit(discordId, amount);
  logLedger({ type: meta.type || 'credit', toId: discordId, byId: meta.byId || null, amount, reason: meta.reason || '', guildId: meta.guildId || null });
  return user;
}

/** Resta Coinks; lanza InsufficientFundsError si no alcanza. */
async function removeCoinks(discordId, amount, meta = {}) {
  assertAmount(amount);
  const user = await _debit(discordId, amount);
  logLedger({ type: meta.type || 'debit', fromId: discordId, amount, reason: meta.reason || '', guildId: meta.guildId || null });
  return user;
}

/** Transfiere entre usuarios. Si el abono falla, se reembolsa al emisor. */
async function transferCoinks(fromId, toId, amount, meta = {}) {
  assertAmount(amount);
  if (fromId === toId) throw new RangeError('No puedes transferirte a ti mismo.');
  await _debit(fromId, amount);
  try {
    await _credit(toId, amount);
  } catch (err) {
    await _credit(fromId, amount).catch((e) => console.error('[economy] FALLÓ el reembolso', fromId, amount, e));
    throw err;
  }
  logLedger({ type: 'transfer', fromId, toId, amount, reason: meta.reason || '', guildId: meta.guildId || null });
}

/** Reparte `amount` a cada id con operaciones en bloque. Devuelve cuántos usuarios recibieron. */
async function airdropCoinks(ids, amount, meta = {}) {
  assertAmount(amount);
  const CHUNK = 1000;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const ops = ids.slice(i, i + CHUNK).map((id) => ({
      updateOne: {
        filter: { discordId: id },
        update: { $inc: { coinks: amount }, $setOnInsert: { discordId: id } },
        upsert: true,
      },
    }));
    await User.bulkWrite(ops, { ordered: false });
  }
  // Una sola entrada agregada (no miles) para mantener el libro manejable.
  logLedger({
    type: 'airdrop',
    byId: meta.byId || null,
    amount: amount * ids.length,
    reason: `${meta.reason || 'airdrop'} (${ids.length} usuarios x ${amount})`,
    guildId: meta.guildId || null,
  });
  return ids.length;
}

module.exports = {
  InsufficientFundsError,
  getUser,
  addCoinks,
  removeCoinks,
  transferCoinks,
  airdropCoinks,
  logLedger,
};
