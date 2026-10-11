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
const ownerCache = new Map(); // red:contrato:tokenId -> { owner, expires }
const ownerInflight = new Map(); // misma clave -> promesa en curso (evita lecturas duplicadas simultáneas)
const OWNER_TTL_MS = 10 * 60 * 1000;
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

  let uri = await contract.tokenURI(tokenId);
  uri = uri.replace('{id}', BigInt(tokenId).toString(16).padStart(64, '0'));
  const attrs = normalizeAttributes(await fetchJson(uri));

  if (metadataCache.size > 50_000) metadataCache.clear(); // tope simple de memoria
  metadataCache.set(key, { attrs, expires: Date.now() + METADATA_TTL_MS });
  return attrs;
}

/**
 * Lee lo que una wallet posee de una colección.
 * - Sin reglas por rasgos: solo balanceOf (1 llamada, funciona con cualquier ERC-721).
 * - Con reglas por rasgos: necesita ERC721Enumerable para listar los tokenIds + sus metadatos.
 * Cualquier fallo lanza error: el llamador NO debe quitar roles cuando hay error.
 * Devuelve { count, tokens: [{ id, attrs }] }
 */
async function getHoldings(col, wallet, needTraits) {
  const contract = getContract(col);
  const count = Number(await contract.balanceOf(wallet));
  if (!needTraits || count === 0) return { count, tokens: [] };

  const n = Math.min(count, config.nft.maxTokensPerWallet);
  let ids;
  try {
    ids = await mapLimit([...Array(n).keys()], config.nft.concurrency, (i) => contract.tokenOfOwnerByIndex(wallet, i));
  } catch (err) {
    throw new Error(`La colección no soporta ERC721Enumerable (necesario para roles por rasgos): ${err.shortMessage || err.message}`);
  }
  const tokens = await mapLimit(ids, config.nft.concurrency, async (id) => ({
    id: id.toString(),
    attrs: await getTokenAttributes(col, contract, id),
  }));
  return { count, tokens };
}

/**
 * Dueño actual de cada tokenId (ownerOf), en minúsculas. Devuelve Map<tokenId(string), direccion|null>.
 * - Token inexistente o quemado (el contrato revierte) -> null: no es un fallo, simplemente nadie lo tiene.
 * - Fallo de RPC/red -> LANZA el error (el llamador NO debe quitar roles por un fallo temporal).
 * Cachea 10 min por token, así una sincronización con cientos de usuarios lee cada token una sola vez.
 */
async function getTokenOwners(col, tokenIds) {
  const contract = getContract(col);
  const owners = new Map();
  await mapLimit([...new Set(tokenIds.map(String))], config.nft.concurrency, async (id) => {
    const key = `${col.network}:${col.contractAddress}:${id}`;
    const hit = ownerCache.get(key);
    if (hit && hit.expires > Date.now()) return void owners.set(id, hit.owner);
    if (!ownerInflight.has(key)) {
      ownerInflight.set(key, (async () => {
        try {
          const owner = String(await contract.ownerOf(BigInt(id))).toLowerCase();
          return owner;
        } catch (err) {
          if (err.code === 'CALL_EXCEPTION') return null; // revert: el token no existe / está quemado
          throw err;
        }
      })().finally(() => ownerInflight.delete(key)));
    }
    const owner = await ownerInflight.get(key);
    if (ownerCache.size > 50_000) ownerCache.clear();
    ownerCache.set(key, { owner, expires: Date.now() + OWNER_TTL_MS });
    owners.set(id, owner);
  });
  return owners;
}

module.exports = { getTokenOwners, norm, ANY_VALUE, hasEmptyValue, normalizeAddress, verifyContract, getHoldings };
