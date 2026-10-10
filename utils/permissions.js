// Modelo de permisos del bot:
//   SUPERADMIN = dueño del servidor o miembro con el permiso de Discord "Administrador".
//                Es el único que puede autorizar roles (/set-admin-role).
//   ADMIN DEL BOT = superadmin + miembros con el permiso de Discord "Gestionar servidor" (ManageGuild)
//                + miembros de un rol autorizado con /set-admin-role (o listado en ADMIN_ROLE_IDS del .env).
// Todo lo demás es público. La comprobación se hace en events/interactionCreate.js con las marcas
// `adminOnly` / `superAdminOnly` de cada comando o componente, así no se puede olvidar en un comando nuevo.
// Para exigir solo Administrador (sin "Gestionar servidor"), quita la línea marcada abajo.
const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const { getGuildConfig } = require('./guildConfig');

function isSuperAdmin(member) {
  if (!member?.guild) return false;
  return member.guild.ownerId === member.id || member.permissions.has(PermissionFlagsBits.Administrator);
}

async function isBotAdmin(member) {
  if (!member?.guild) return false;
  if (isSuperAdmin(member)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true; // <- quita esta línea para exigir Administrador
  const cfg = await getGuildConfig(member.guild.id);
  return [...cfg.adminRoleIds, ...config.adminRoleIds].some((id) => member.roles.cache.has(id));
}

module.exports = { isSuperAdmin, isBotAdmin, isEconomyAdmin: isBotAdmin };
