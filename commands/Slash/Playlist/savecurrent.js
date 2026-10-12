const { ApplicationCommandType, ApplicationCommandOptionType, PermissionFlagsBits } = require("discord.js");
const Store = require("../../../handlers/PlaylistStore");

module.exports = {
  name: "playlistsavecurrent",
  description: `Salvar a musica atual na playlist`,
  userPermissions: PermissionFlagsBits.SendMessages,
  botPermissions: PermissionFlagsBits.SendMessages,
  category: "Playlist",
  cooldown: 3,
  type: ApplicationCommandType.ChatInput,
  options: [
    { name: "name", description: "Nome da Playlist", type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
  ],
  inVoiceChannel: false,
  inSameVoiceChannel: false,
  Player: false,
  djOnly: false,
  run: async (client, interaction) => {
    const name = interaction.options.getString("name");
    const q = client.distube.getQueue(interaction.guild.id);
    if (!q || !q.songs?.length) return client.embed(interaction, `${client.config.emoji.ERROR} Nada está tocando.`);
    const track = Store.serializeSong(q.songs[0], interaction.user);
    await Store.create(client, interaction.guild.id, interaction.user.id, name);
    await Store.addTracks(client, interaction.guild.id, interaction.user.id, name, [track]);
    return client.embed(interaction, `${client.config.emoji.SUCCESS} Musica atual salva para \`${name}\`.`);
  },
  autocomplete: async (client, interaction) => {
    const focused = interaction.options.getFocused()?.toLowerCase?.() || "";
    const alls = await Store.getAll(client, interaction.guild.id, interaction.user.id);
    const choices = alls.map(p => p.name).filter(Boolean);
    const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(n => ({ name: n, value: n })));
  }
};
