const {
  CommandInteraction,
  PermissionFlagsBits,
  ApplicationCommandType,
  ApplicationCommandOptionType,
} = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "remove",
  description: `Remover a musica da fila atual`,
  userPermissions: PermissionFlagsBits.Connect,
  botPermissions: PermissionFlagsBits.Connect,
  category: "Music",
  cooldown: 5,
  type: ApplicationCommandType.ChatInput,
  inVoiceChannel: true,
  inSameVoiceChannel: true,
  Player: true,
  djOnly: true,
  options: [
    {
      name: "trackindex",
      description: `Dê o index da musica`,
      type: ApplicationCommandOptionType.Number,
      required: true,
    },
  ],

  /**
   *
   * @param {JUGNU} client
   * @param {CommandInteraction} interaction
   * @param {String[]} args
   * @param {Queue} queue
   */
  run: async (client, interaction, args, queue) => {
    // Code

    try {
      const songIndex = interaction.options.getNumber("trackindex");

      if (
        !songIndex ||
        isNaN(songIndex) ||
        songIndex < 1 ||
        songIndex > queue.songs.length
      ) {
        return client.embed(interaction, "Por favor coloque o index da musica.");
      }

      let removedTrack = queue.songs.splice(songIndex - 1, 1)[0];
      if (!removedTrack) {
        return client.embed(
          interaction,
          "Falha ao remover da fila."
        );
      }

      client.embed(
        interaction,
        `${client.config.emoji.SUCCESS} Removido \`${client.getTitle(
          removedTrack
        )}\` Da fila !!`
      );
    } catch (error) {
      console.error(error);
      client.embed(
        interaction,
        `${client.config.emoji.ERROR} Um erro aconteceu: ${error.message}`
      );
    }
  },
};
