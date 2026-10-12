const {
  CommandInteraction,
  EmbedBuilder,
  ApplicationCommandType,
  PermissionFlagsBits,
} = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "nowplaying",
  description: `Ver o que está tocando agora`,
  userPermissions: PermissionFlagsBits.Connect,
  botPermissions: PermissionFlagsBits.Connect,
  category: "Music",
  cooldown: 5,
  type: ApplicationCommandType.ChatInput,
  inVoiceChannel: false,
  inSameVoiceChannel: false,
  Player: true,
  djOnly: false,

  /**
   *
   * @param {JUGNU} client
   * @param {CommandInteraction} interaction
   * @param {String[]} args
   * @param {Queue} queue
   */
  run: async (client, interaction, args, queue) => {
    // Code
    let song = queue.songs[0];

    interaction.followUp({
      embeds: [
        new EmbedBuilder()
          .setColor(client.config.embed.color)
          .setThumbnail(song.thumbnail)
          .setAuthor({
            name: `Now Playing`,
            iconURL: song.thumbnail,
            url: song.url,
          })
          .setDescription(`** [${client.getTitle(song)}](${song.streamURL}) **`)
          .addFields([
            {
              name: `** Duração **`,
              value: ` \`${queue.formattedCurrentTime}/${song.formattedDuration} \``,
              inline: true,
            },
            {
              name: `** Requerido por **`,
              value: ` \`${song.user.tag} \``,
              inline: true,
            },
            {
              name: `** Autor **`,
              value: ` \`${song.uploader.name}\``,
              inline: true,
            },
          ])
          .setFooter(client.getFooter(interaction.user)),
      ],
    });
  },
};
