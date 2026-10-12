const { Message, PermissionFlagsBits } = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "jump",
  aliases: ["jmp", "jp"],
  description: `Pule para uma musica da fila por index`,
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
    // Code
    let index = Number(args[0]);
    if (!index) {
      return client.embed(
        message,
        `${client.config.emoji.ERROR} Proporcione um index`
      );
    }
    let song = queue.songs[index];
    if (index > queue.songs.length - 1 || index < 0) {
      return client.embed(
        message,
        `${
          client.config.emoji.ERROR
        } **Está posição está entre \`0\` e \`${
          queue.songs.length - 1
        }\`!**`
      );
    } else {
      queue.jump(index).then((q) => {
        client.embed(
          message,
          `** ${
            client.config.emoji.SUCCESS
          } Pular para a musica [\`${client.getTitle(song)}\`](${song.url}) **`
        );
      });
    }
  },
};
