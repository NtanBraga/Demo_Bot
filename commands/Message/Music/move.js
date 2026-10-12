const { Message, PermissionFlagsBits } = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "move",
  aliases: ["mv", "nvs"],
  description: `Mover video`,
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
    let songIndex = Number(args[0]);
    let position = Number(args[1]);
    if (!songIndex || !position) {
      return client.embed(
        message,
        `${client.config.emoji.ERROR} Modo errado de uso :: ${prefix}move <songindex> <targetindex>`
      );
    }
    if (position >= queue.songs.length || position < 0) position = -1;
    if (songIndex > queue.songs.length - 1) {
      return client.embed(
        message,
        ` **O ultimo video tem o index: \`${queue.songs.length}\`**`
      );
    } else if (position === 0) {
      return client.embed(message, `**Não pode mover para a posição antes do video atual!**`);
    } else {
      let song = queue.songs[songIndex];
      //remove the song
      queue.songs.splice(songIndex);
      //Add it to a specific Position
      queue.addToQueue(song, position);
      client.embed(
        message,
        `📑 Movido **${client.getTitle(
          song
        )}** para posição **\`${position}ª\`** antes de **_${
          queue.songs[position - 1].name
        }_!**`
      );
    }
  },
};
