const { ApplicationCommandType, ApplicationCommandOptionType, PermissionFlagsBits } = require("discord.js");
const Store = require("../../../handlers/PlaylistStore");

module.exports = {
  name: "playlistremovetrack",
  description: `Remover uma musica da playlist por index (base-1)`,
  userPermissions: PermissionFlagsBits.SendMessages,
  botPermissions: PermissionFlagsBits.SendMessages,
  category: "Playlist",
  cooldown: 3,
  type: ApplicationCommandType.ChatInput,
  options: [
    { name: "name", description: "Nome da Playlist", type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
    { name: "index", description: "Numero da musica (base-1)", type: ApplicationCommandOptionType.Integer, required: true },
  ],
  run: async (client, interaction) => {
    const name = interaction.options.getString("name");
    const idx = interaction.options.getInteger("index");
    const pl = await Store.get(client, interaction.guild.id, interaction.user.id, name);
    if (!pl) return client.embed(interaction, `${client.config.emoji.ERROR} Playlist não encontrada.`);
    const removed = await Store.removeTrack(client, interaction.guild.id, interaction.user.id, pl.name, idx);
    if (!removed) return client.embed(interaction, `${client.config.emoji.ERROR} Index inválida. `);
    return client.embed(interaction, `${client.config.emoji.SUCCESS} Removida \`${removed.name}\` de \`${pl.name}\`.`);
  },
  autocomplete: async (client, interaction) => {
    const focused = interaction.options.getFocused()?.toLowerCase?.() || "";
    const alls = await Store.getAll(client, interaction.guild.id, interaction.user.id);
    const choices = alls.map(p => p.name).filter(Boolean);
    const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(n => ({ name: n, value: n })));
  }
};
