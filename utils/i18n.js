// Internacionalización ES/EN.
// Prioridad de idioma:  preferencia guardada (/idioma) > idioma del cliente de Discord del usuario
//                       > idioma preferido del servidor > DEFAULT_LANG (por defecto: inglés).
const config = require('../config');
const User = require('../models/User');

const dicts = { es: require('../locales/es'), en: require('../locales/en') };
const overrides = new Map(); // discordId -> 'es' | 'en' | null (caché de la preferencia manual)

function lookup(dict, key) {
  let o = dict;
  for (const k of key.split('.')) {
    if (o == null) return undefined;
    o = o[k];
  }
  return o;
}

const has = (lang, key) => lookup(dicts[lang], key) !== undefined || lookup(dicts.en, key) !== undefined || lookup(dicts.es, key) !== undefined;

/** Traduce `key`. Si el valor es un array, devuelve una variante al azar. Reemplaza {variables}. */
function t(lang, key, vars = {}) {
  let v = lookup(dicts[lang], key);
  if (v === undefined) v = lookup(dicts.en, key); // respaldo: inglés (idioma por defecto)
  if (v === undefined) v = lookup(dicts.es, key);
  if (v === undefined) return key;
  if (Array.isArray(v)) v = v[Math.floor(Math.random() * v.length)];
  return String(v).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

/** Prueba varias claves en orden y usa la primera que exista (p. ej. texto por zona -> texto genérico). */
function tOr(lang, keys, vars) {
  const found = keys.find((k) => has(lang, k));
  return found ? t(lang, found, vars) : keys[keys.length - 1];
}

/** Opción de comando con nombre localizado (para SlashCommandBuilder.addChoices). */
function choice(key, value, vars) {
  const en = t('en', key, vars).slice(0, 100);
  return { name: t('es', key, vars).slice(0, 100), name_localizations: { 'en-US': en, 'en-GB': en }, value };
}

function fromLocale(locale) {
  const l = String(locale || '').toLowerCase();
  if (l.startsWith('es')) return 'es';
  if (l.startsWith('en')) return 'en';
  return null;
}

async function getOverride(discordId) {
  if (overrides.has(discordId)) return overrides.get(discordId);
  const u = await User.findOne({ discordId }).select('lang').lean();
  const v = u?.lang || null;
  if (overrides.size > 20000) overrides.clear();
  overrides.set(discordId, v);
  return v;
}

async function setOverride(discordId, lang) {
  await User.updateOne({ discordId }, { $set: { lang: lang || null }, $setOnInsert: { discordId } }, { upsert: true });
  overrides.set(discordId, lang || null);
}

/** Idioma de una interacción de Discord. */
async function resolveLang(interaction) {
  const manual = await getOverride(interaction.user.id).catch(() => null);
  return manual || fromLocale(interaction.locale) || fromLocale(interaction.guildLocale) || config.defaultLang;
}

/** Idioma para mensajes sin interacción (DM, avisos): preferencia guardada o idioma por defecto. */
async function langForUser(discordId) {
  return (await getOverride(discordId).catch(() => null)) || config.defaultLang;
}

/** Idioma para mensajes públicos del servidor (tienda, logs): idioma preferido del servidor o DEFAULT_LANG. */
const langForGuild = (guild) => fromLocale(guild?.preferredLocale) || config.defaultLang;

module.exports = { t, tOr, has, choice, resolveLang, langForUser, langForGuild, setOverride, fromLocale, dicts };
