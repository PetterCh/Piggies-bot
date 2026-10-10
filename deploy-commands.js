// Registra los slash commands en Discord. Ejecuta: npm run deploy (cada vez que cambies/añadas comandos).
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const config = require('./config');
const { loadCommands } = require('./utils/loader');

(async () => {
  const commands = [...loadCommands(path.join(__dirname, 'commands')).values()].map((c) => c.data.toJSON());
  const rest = new REST().setToken(config.token);
  const route = config.guildId ? Routes.applicationGuildCommands(config.clientId, config.guildId) : Routes.applicationCommands(config.clientId);
  const res = await rest.put(route, { body: commands });
  console.log(`✅ ${res.length} comandos registrados ${config.guildId ? `en el servidor ${config.guildId}` : 'globalmente'}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
