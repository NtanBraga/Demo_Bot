const { Message, PermissionFlagsBits } = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "remove",
  aliases: ["rem", "remsong"],
  description: `Remover a musica da fila atual`,
  userPermissions: PermissionFlagsBits.Connect,
  botPermissions: PermissionFlagsBits.Connect,
  category: "Music",
  cooldown: 5,
  inVoiceChannel: true,
  inSameVoiceChannel: true,
  Player: true,
  djOnly: true,

  /**
   *
   * @param {JUGNU} client
   * @param {Message} message
   * @param {String[]} args
   * @param {String} prefix
   * @param {Queue} queue
   */
  run: async (client, message, args, prefix, queue) => {
    try {
      let songIndex = Number(args[0]);

      if (
        !songIndex ||
        isNaN(songIndex) ||
        songIndex < 1 ||
        songIndex > queue.songs.length
      ) {
        return client.embed(message, "Por favor coloque o index da musica.");
      }

      let removedTrack = queue.songs.splice(songIndex - 1, 1)[0];
      if (!removedTrack) {
        return client.embed(
          message,
          "Falha ao remover da fila."
        );
      }

      client.embed(
        message,
        `${client.config.emoji.SUCCESS} Removido \`${client.getTitle(
          removedTrack
        )}\` Da fila !!`
      );
    } catch (error) {
      console.error(error);
      client.embed(
        message,
        `${client.config.emoji.ERROR} Um erro aconteceu: ${error.message}`
      );
    }
  },
};
