// Índice interno token -> dueño (MongoDB). La verificación de roles por Token ID usa SOLO esto: cero llamadas a la blockchain.
const TokenOwner = require('../models/TokenOwner');
const { normalizeAddress, ownerOfToken } = require('../utils/blockchain');
const { sleep } = require('../utils/helpers');
const config = require('../config');

const cache = new Map(); // red:contrato -> { at, map }  (caché de 60 s: una sincronización con muchos usuarios lee Mongo una vez)
const CACHE_MS = 60 * 1000;
const keyOf = (col) => `${col.network}:${col.contractAddress}`;

/** Map<tokenId, owner|null> de los IDs pedidos que existen en el índice (los que no están, no aparecen). */
async function ownersFor(col, tokenIds) {
  const k = keyOf(col);
  const hit = cache.get(k);
  let all = hit && Date.now() - hit.at < CACHE_MS ? hit.map : null;
  if (!all) {
    const rows = await TokenOwner.find({ network: col.network, contractAddress: col.contractAddress }).select('tokenId owner updatedAt').lean();
    all = new Map(rows.map((r) => [r.tokenId, { owner: r.owner, updatedAt: r.updatedAt }]));
    cache.set(k, { at: Date.now(), map: all });
  }
  const out = new Map();
  for (const id of tokenIds) if (all.has(String(id))) out.set(String(id), all.get(String(id)));
  return out;
}
const clearCache = () => cache.clear();

/**
 * Lee un archivo de snapshot y devuelve { rows: [{tokenId, owner}], bad: [texto...] }.
 * Acepta CSV/TSV/;  ("token_id,wallet", con o sin cabecera) o JSON ({"3":"0x…"} o [{token_id, owner|wallet|address}]).
 */
function parseSnapshot(text) {
  const rows = [];
  const bad = [];
  const push = (id, addr, raw) => {
    const tokenId = String(id ?? '').trim();
    const owner = addr == null || String(addr).trim() === '' ? null : normalizeAddress(addr);
    if (!/^\d+$/.test(tokenId) || (addr != null && String(addr).trim() !== '' && !owner)) return bad.push(String(raw).slice(0, 80));
    rows.push({ tokenId, owner });
  };
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const json = JSON.parse(trimmed);
    const list = Array.isArray(json) ? json : Object.entries(json).map(([token_id, owner]) => ({ token_id, owner }));
    for (const r of list) push(r.token_id ?? r.tokenId ?? r.id, r.owner ?? r.wallet ?? r.address, JSON.stringify(r));
  } else {
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [a, b] = line.split(/[,;\t]/).map((x) => x.replace(/^["']|["']$/g, '').trim());
      if (!/^\d+$/.test(a ?? '')) continue; // cabecera u otra línea no numérica
      push(a, b, line);
    }
  }
  return { rows, bad };
}

/** Guarda filas en el índice (upsert por lotes). */
async function saveRows(col, rows, source) {
  let n = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    await TokenOwner.bulkWrite(chunk.map((r) => ({
      updateOne: {
        filter: { network: col.network, contractAddress: col.contractAddress, tokenId: r.tokenId },
        update: { $set: { owner: r.owner, source }, $setOnInsert: { network: col.network, contractAddress: col.contractAddress, tokenId: r.tokenId } },
        upsert: true,
      },
    })));
    n += chunk.length;
  }
  clearCache();
  return n;
}

/**
 * Refresco LENTO desde la cadena (solo los IDs que piden los grupos): 1 lectura a la vez, con pausa entre lecturas.
 * Un fallo NO borra el dato anterior. Se corta si fallan 10 seguidas (proveedor caído).
 * Devuelve { ok, failed, changed, aborted }  (changed = tokens cuyo dueño es distinto al guardado o que no estaban).
 */
async function refreshFromChain(col, tokenIds, { delayMs = config.nft.tokenOwners.delayMs, onProgress } = {}) {
  clearCache();
  const before = await ownersFor(col, tokenIds);
  let changed = 0;
  let ok = 0;
  let failed = 0;
  let streak = 0;
  const ids = [...new Set(tokenIds.map(String))];
  for (let i = 0; i < ids.length; i++) {
    try {
      const owner = await ownerOfToken(col, ids[i]);
      await saveRows(col, [{ tokenId: ids[i], owner }], 'chain');
      if (!before.has(ids[i]) || before.get(ids[i]).owner !== owner) changed++;
      ok++;
      streak = 0;
    } catch (err) {
      failed++;
      streak++;
      console.error(`[nft] tokens-actualizar ${col.name} #${ids[i]}: ${err.shortMessage || err.message}`);
      if (streak >= 10) return { ok, failed, changed, aborted: true };
    }
    if (onProgress && (i + 1) % 20 === 0) await onProgress(i + 1, ids.length).catch(() => {});
    await sleep(delayMs);
  }
  return { ok, failed, changed, aborted: false };
}

let autoRunning = false;
/**
 * Llenado AUTOMÁTICO del índice, en segundo plano y fuera de la sincronización de roles:
 * recorre las colecciones con grupos de Token ID, lee despacio los IDs que faltan o están desactualizados (más de `maxAgeHours`)
 * y, si algo cambió, vuelve a sincronizar los roles de ese servidor (que sigue leyendo solo MongoDB).
 */
async function autoRefresh(client, { maxAgeHours = 24 } = {}) {
  if (!config.nft.tokenOwners.auto || autoRunning) return;
  autoRunning = true;
  try {
    const { getGuildCollections, syncGuild } = require('./nftSync'); // require tardío: nftSync también importa este módulo
    const tokenRoles = require('./tokenRoles');
    for (const guild of client.guilds.cache.values()) {
      const cols = await getGuildCollections(guild.id);
      for (const col of cols) {
        const ids = [...new Set(tokenRoles.resolveGroups(cols).resolved.filter((g) => g.col === col).flatMap((g) => g.tokenIds))];
        if (!ids.length) continue;
        const have = await ownersFor(col, ids);
        const stale = Date.now() - maxAgeHours * 3600_000;
        const todo = ids.filter((id) => !have.has(id) || new Date(have.get(id).updatedAt).getTime() < stale);
        if (!todo.length) continue;
        console.log(`[nft] Índice de Token IDs: leyendo ${todo.length} tokens de ${col.name} despacio (${have.size ? 'actualización' : 'primera carga'})…`);
        const r = await refreshFromChain(col, todo);
        console.log(`[nft] Índice de ${col.name}: ${r.ok} leídos, ${r.failed} fallidos, ${r.changed} cambios${r.aborted ? ' (cortado por fallos del RPC; se reintenta en el próximo ciclo)' : ''}.`);
        if (r.changed > 0) await syncGuild(guild).catch((e) => console.error('[nft] sync tras índice:', e.message));
      }
    }
  } catch (err) {
    console.error('[nft] autoRefresh:', err.message);
  } finally {
    autoRunning = false;
  }
}

module.exports = { autoRefresh, ownersFor, parseSnapshot, saveRows, refreshFromChain, clearCache };
