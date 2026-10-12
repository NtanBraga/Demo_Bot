const { ApplicationCommandType, ApplicationCommandOptionType, PermissionFlagsBits } = require("discord.js");
const Store = require("../../../handlers/PlaylistStore");

module.exports = {
  name: "playlistplay",
  description: `Tocar uma playlist salva`,
  userPermissions: PermissionFlagsBits.SendMessages,
  botPermissions: PermissionFlagsBits.SendMessages,
  category: "Playlist",
  cooldown: 3,
  type: ApplicationCommandType.ChatInput,
  options: [
    { name: "name", description: "Nome da Playlist", type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
  ],
  run: async (client, interaction) => {
    const name = interaction.options.getString("name");
    const pl = await Store.get(client, interaction.guild.id, interaction.user.id, name);
    if (!pl || !pl.tracks.length) return client.embed(interaction, `${client.config.emoji.ERROR} Playlist está vazia ou não encontrada.`);
    const vc = interaction.member.voice.channel;
    if (!vc) return client.embed(interaction, `${client.config.emoji.ERROR} Entre em um canal primeiro.`);
    if (interaction.guild.members.me.voice.channel && !interaction.guild.members.me.voice.channel.equals(vc))
      return client.embed(interaction, `${client.config.emoji.ERROR} Você precisa está no meu canal.`);
    const first = pl.tracks[0];
    await client.distube.play(vc, first.url || first.name, {
      member: interaction.member,
      textChannel: interaction.channel,
      message: interaction,
    });
    for (const t of pl.tracks.slice(1)) {
      await client.distube.play(vc, t.url || t.name, {
        member: interaction.member,
        textChannel: interaction.channel,
        message: interaction,
      });
    }
    return client.embed(interaction, `${client.config.emoji.SUCCESS} Tocando playlist \`${pl.name}\` (${pl.tracks.length} musicas).`);
  },
  autocomplete: async (client, interaction) => {
    const focused = interaction.options.getFocused()?.toLowerCase?.() || "";
    const alls = await Store.getAll(client, interaction.guild.id, interaction.user.id);
    const choices = alls.map(p => p.name).filter(Boolean);
    const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(n => ({ name: n, value: n })));
  }
};
