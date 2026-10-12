const { ActivityType, Events } = require("discord.js");
const client = require("../index");
const { registerSlashCommands } = require("../handlers/functions");
const server = require("../server.js");
const Database = require("../handlers/Database");

client.once(Events.ClientReady, async (readyclient) => {
  try {
    console.log(`${client.user.username} is Online`);

    readyclient.user.setStatus('idle')

    const status = [
      {type: ActivityType.Listening, name: "/play"},
      {type: ActivityType.Listening, name: "Blinblin"},
      {type: ActivityType.Listening, name: "Vozes"},
    ]

    setInterval(() => {
      const index = Math.floor(Math.random() * status.length)
      client.user.setActivity(status[index].name, {type: status[index].type})
    }, 5000)

    // Load database
    await Database(client);

    // Reset music embeds for all guilds one by one
    for (const guild of client.guilds.cache.values()) {
      await client.updateembed(client, guild);
    }

    // Register slash commands
    await registerSlashCommands(client);

    // Load dashboard
    await server(client);
  } catch (error) {
    console.error("An error occurred during initialization:", error);
  }
});
