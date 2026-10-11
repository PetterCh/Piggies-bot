// Roles por TOKEN ID concreto (p. ej. los 1/1): la lista vive en un JSON externo y se puede cambiar sin tocar el código.
//
// Fuente (la primera que exista):
//   1) variable de entorno TOKEN_ROLES_JSON  (el JSON completo; cómoda en Railway: editas la variable y reinicias)
//   2) archivo TOKEN_ROLES_FILE              (por defecto data/token-roles.json; se relee solo si cambia)
//
// Formato:
//   { "roles": [ { "nombre_referencia": "Piggies OG 1/1", "coleccion": "Piggies", "role_id": "123…", "token_ids": [3, 853, …] } ] }
//   - coleccion: nombre o contrato de una colección registrada con /nft-registrar coleccion. Es OBLIGATORIA salvo que solo
//     haya una colección activa, porque los mismos IDs (p. ej. 996 o 999) existen en colecciones distintas.
//   - role_id: ID del rol de Discord. Mientras sea un texto de relleno ("TU_DISCORD_ROLE_ID_AQUI") el grupo se ignora.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeAddress } = require('../utils/blockchain');
const tokenOwners = require('./tokenOwners');

const FILE = path.resolve(process.env.TOKEN_ROLES_FILE || path.join(__dirname, '..', 'data', 'token-roles.json'));
const ROLE_ID_RE = /^\d{17,20}$/;
let fileCache = { mtime: 0, groups: [], problems: [] };

/** Lee y valida el JSON. Devuelve { groups, problems, source }. Nunca lanza: un JSON roto solo desactiva esta función. */
function loadGroups() {
  let raw;
  let source;
  const problems = [];
  try {
    if (process.env.TOKEN_ROLES_JSON) {
      raw = process.env.TOKEN_ROLES_JSON;
      source = 'TOKEN_ROLES_JSON';
    } else if (fs.existsSync(FILE)) {
      const mtime = fs.statSync(FILE).mtimeMs;
      if (mtime === fileCache.mtime) return { groups: fileCache.groups, problems: fileCache.problems, source: FILE };
      raw = fs.readFileSync(FILE, 'utf8');
      source = FILE;
      const parsed = parse(raw, problems);
      fileCache = { mtime, groups: parsed, problems };
      return { groups: parsed, problems, source };
    } else {
      return { groups: [], problems, source: null };
    }
  } catch (err) {
    problems.push(`No pude leer la configuración: ${err.message}`);
    return { groups: [], problems, source: null };
  }
  return { groups: parse(raw, problems), problems, source };
}

function parse(raw, problems) {
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    problems.push(`JSON inválido: ${err.message}`);
    return [];
  }
  const list = Array.isArray(json) ? json : json.roles;
  if (!Array.isArray(list)) {
    problems.push('El JSON debe tener un array "roles".');
    return [];
  }
  const groups = [];
  list.forEach((g, i) => {
    const ref = String(g.nombre_referencia || g.name || `grupo ${i + 1}`);
    const roleId = String(g.role_id ?? '').trim();
    const ids = [...new Set((g.token_ids || []).map((n) => String(n).trim()))];
    const bad = ids.filter((n) => !/^\d+$/.test(n));
    if (bad.length) { problems.push(`${ref}: token_ids no numéricos ignorados (${bad.slice(0, 5).join(', ')})`); }
    const tokenIds = ids.filter((n) => /^\d+$/.test(n));
    if (!ROLE_ID_RE.test(roleId)) return problems.push(`${ref}: role_id pendiente o inválido ("${roleId.slice(0, 30)}"), el grupo se ignora hasta que pongas el ID real.`);
    if (!tokenIds.length) return problems.push(`${ref}: no tiene token_ids.`);
    groups.push({ ref, description: g.descripcion || g.description || '', roleId, collection: g.coleccion ?? g.collection ?? null, tokenIds });
  });
  return groups;
}

/** Enlaza cada grupo con una colección registrada. Devuelve { resolved: [{...grupo, col}], problems }. */
function resolveGroups(collections) {
  const { groups, problems: loadProblems } = loadGroups();
  const problems = [...loadProblems];
  const resolved = [];
  for (const g of groups) {
    let col = null;
    if (g.collection) {
      const addr = normalizeAddress(g.collection);
      const key = String(g.collection).trim().toLowerCase();
      col = collections.find((c) => (addr ? c.contractAddress === addr : c.nameKey === key));
      if (!col) { problems.push(`${g.ref}: no hay una colección activa llamada/contrato "${g.collection}" (mira /nft-registrar listar).`); continue; }
    } else if (collections.length === 1) {
      col = collections[0];
    } else {
      problems.push(`${g.ref}: falta "coleccion" (hay ${collections.length} colecciones y los IDs se repiten entre ellas).`);
      continue;
    }
    resolved.push({ ...g, col });
  }
  return { resolved, problems };
}

/** IDs de los roles que gestiona esta función (para poder quitarlos cuando ya no corresponden). */
const managedRoleIds = (collections) => new Set(resolveGroups(collections).resolved.map((g) => g.roleId));

/**
 * Roles que corresponden a un conjunto de wallets. Lee SOLO el índice interno de MongoDB (services/tokenOwners.js):
 * no llama a la blockchain ni a metadatos. `failed` = grupos sin ningún dato en el índice: su rol NO se quita (aún no hay snapshot).
 */
async function evaluateTokenRoles(collections, addresses) {
  const desired = new Set();
  const failed = new Set();
  if (!addresses.length) return { desired, failed };
  const mine = new Set(addresses.map((a) => String(a).toLowerCase()));
  for (const g of resolveGroups(collections).resolved) {
    const owners = await tokenOwners.ownersFor(g.col, g.tokenIds);
    if (!owners.size) { failed.add(g.roleId); continue; } // sin snapshot: no tocar roles
    if (g.tokenIds.some((id) => { const o = owners.get(id)?.owner; return o && mine.has(o); })) desired.add(g.roleId);
  }
  return { desired, failed };
}

module.exports = { loadGroups, resolveGroups, managedRoleIds, evaluateTokenRoles, FILE };
