// Lectura de NFTs ERC-721 (EVM y Ronin, que es compatible con EVM) usando ethers v6.
const { ethers } = require('ethers');
const config = require('../config');
const { mapLimit } = require('./helpers');

const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)', // ERC721Enumerable
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
];

const DEAD = '0x000000000000000000000000000000000000dEaD';
const providers = new Map(); // url -> provider
const metadataCache = new Map(); // clave -> { attrs, expires }
const holdingsCache = new Map(); // red:contrato:wallet -> { value, expires } (evita releer la misma wallet en pocos minutos)
const HOLDINGS_TTL_MS = 3 * 60 * 1000;
const METADATA_TTL_MS = 6 * 60 * 60 * 1000;

/** Normaliza texto para comparar rasgos sin distinguir mayúsculas/espacios. */
const norm = (s) => String(s).trim().toLowerCase();

/** Valor reservado de una regla de rasgo: "cualquier valor de esta categoría" (/nft-registrar rasgo sin `valor`). */
const ANY_VALUE = '*';
/** Valores que significan "no tiene el rasgo" aunque el atributo exista en los metadatos. */
const EMPTY_VALUES = new Set(['', 'none', 'null', 'n/a', 'na', 'no', 'ninguno', 'ninguna', 'nada', '-', 'undefined']);
const hasEmptyValue = (normalizedValue) => EMPTY_VALUES.has(normalizedValue);

/**
 * Devuelve la dirección en formato 0x minúsculas, o null si no es válida.
 * Acepta el prefijo "ronin:" (se convierte a 0x).
 */
function normalizeAddress(input) {
  let a = String(input || '').trim();
  if (a.toLowerCase().startsWith('ronin:')) a = '0x' + a.slice(6);
  if (!ethers.isAddress(a)) return null; // valida formato (y checksum si viene en mayúsculas mixtas)
  return ethers.getAddress(a.toLowerCase()).toLowerCase();
}

function getProvider(network, rpcOverride) {
  const url = rpcOverride || config.chains[network]?.rpcUrl;
  if (!url) throw new Error(`Red no soportada: ${network}`);
  if (!providers.has(url)) {
    providers.set(url, new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true }));
  }
  return providers.get(url);
}

const getContract = (col) =>
  new ethers.Contract(col.contractAddress, ERC721_ABI, getProvider(col.network, col.rpcUrl));

/** Comprueba que la dirección responde como un ERC-721 en esa red (lanza si no). */
async function verifyContract(network, address, rpcUrl) {
  const c = new ethers.Contract(address, ERC721_ABI, getProvider(network, rpcUrl));
  await c.balanceOf(DEAD);
}

// ---------- Metadatos / rasgos ----------
function resolveUri(uri) {
  if (uri.startsWith('ipfs://')) return config.nft.ipfsGateway + uri.slice(7).replace(/^ipfs\//, '');
  if (uri.startsWith('ar://')) return 'https://arweave.net/' + uri.slice(5);
  return uri;
}

async function fetchJson(uri) {
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',');
    const meta = uri.slice(0, comma);
    const body = uri.slice(comma + 1);
    const text = meta.includes('base64') ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body);
    return JSON.parse(text);
  }
  const url = resolveUri(uri);
  if (!/^https?:\/\//i.test(url)) throw new Error(`URI no soportada: ${uri.slice(0, 40)}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(config.nft.metadataTimeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} al leer metadatos`);
  return res.json();
}

/** Convierte attributes (formato OpenSea) a { traittype_normalizado: valor_normalizado }. */
function normalizeAttributes(meta) {
  const out = {};
  const attrs = meta.attributes ?? meta.traits ?? [];
  if (Array.isArray(attrs)) {
    for (const a of attrs) if (a && a.trait_type != null && a.value != null) out[norm(a.trait_type)] = norm(a.value);
  } else if (attrs && typeof attrs === 'object') {
    for (const [k, v] of Object.entries(attrs)) if (v != null) out[norm(k)] = norm(v);
  }
  return out;
}

async function getTokenAttributes(col, contract, tokenId) {
  const key = `${col.network}:${col.contractAddress}:${tokenId}`;
  const hit = metadataCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.attrs;

  let uri = await rpc(() => contract.tokenURI(tokenId));
  uri = uri.replace('{id}', BigInt(tokenId).toString(16).padStart(64, '0'));
  const attrs = normalizeAttributes(await fetchJson(uri));

  if (metadataCache.size > 50_000) metadataCache.clear(); // tope simple de memoria
  metadataCache.set(key, { attrs, expires: Date.now() + METADATA_TTL_MS });
  return attrs;
}

/**
 * Ejecuta una lectura RPC con reintentos y espera creciente ante fallos TEMPORALES del proveedor
 * (400/429/5xx, "missing response", timeouts, red). Un revert del contrato (CALL_EXCEPTION) NO se reintenta.
 */
async function rpc(fn, attempts = 4) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.code === 'CALL_EXCEPTION' || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i + Math.random() * 250)); // 0,5 s · 1 s · 2 s (+ jitter)
    }
  }
}

/**
 * Lee lo que una wallet posee de una colección (UNA lectura por wallet y colección, compartida por todas las reglas).
 *  - balanceOf siempre (1 llamada, funciona con cualquier ERC-721).
 *  - ids (needIds): lista los tokenIds de la wallet con tokenOfOwnerByIndex (ERC721Enumerable). SIN metadatos.
 *  - attrs (needAttrs): además descarga el metadato de cada token (solo para reglas por rasgo/categoría).
 * Cualquier fallo lanza error: el llamador NO debe quitar roles cuando hay error.
 * Devuelve { count, ids: string[], truncated, tokens: [{ id, attrs }] }  (tokens solo con needAttrs).
 */
async function getHoldings(col, wallet, { needIds = false, needAttrs = false } = {}) {
  const key = `${col.network}:${col.contractAddress}:${String(wallet).toLowerCase()}:${needIds || needAttrs ? (needAttrs ? 'a' : 'i') : 'c'}`;
  const hit = holdingsCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const contract = getContract(col);
  const count = Number(await rpc(() => contract.balanceOf(wallet)));
  let value = { count, ids: [], truncated: false, tokens: [] };

  if ((needIds || needAttrs) && count > 0) {
    const cap = needAttrs ? config.nft.maxTokensPerWallet : config.nft.maxIdsPerWallet;
    const n = Math.min(count, cap);
    let ids;
    try {
      ids = await mapLimit([...Array(n).keys()], config.nft.concurrency, (i) => rpc(() => contract.tokenOfOwnerByIndex(wallet, i)));
    } catch (err) {
      throw new Error(`La colección ${col.name} no soporta ERC721Enumerable (necesario para listar los tokenIds de una wallet): ${err.shortMessage || err.message}`);
    }
    value = { count, ids: ids.map(String), truncated: count > n, tokens: [] };
    if (needAttrs) {
      value.tokens = await mapLimit(ids, config.nft.concurrency, async (id) => ({ id: id.toString(), attrs: await getTokenAttributes(col, contract, id) }));
    }
  }
  if (holdingsCache.size > 20_000) holdingsCache.clear();
  holdingsCache.set(key, { value, expires: Date.now() + HOLDINGS_TTL_MS });
  return value;
}

/**
 * Dueño de UN token (minúsculas) con reintentos. null = el contrato revierte (token inexistente o quemado).
 * Solo lo usa el refresco lento y manual del índice interno (services/tokenOwners.js), nunca la verificación de roles.
 */
async function ownerOfToken(col, tokenId) {
  try {
    return String(await rpc(() => getContract(col).ownerOf(BigInt(tokenId)))).toLowerCase();
  } catch (err) {
    if (err.code === 'CALL_EXCEPTION') return null;
    throw err;
  }
}

module.exports = { ownerOfToken, norm, ANY_VALUE, hasEmptyValue, normalizeAddress, verifyContract, getHoldings };
