const {
  CommandInteraction,
  PermissionFlagsBits,
  ApplicationCommandType,
  ApplicationCommandOptionType,
} = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "move",
  description: `Mover video`,
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
      description: `Index da musica`,
      type: ApplicationCommandOptionType.Number,
      required: true,
    },
    {
      name: "targetindex",
      description: `Index da musica alvo`,
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
    let songIndex = interaction.options.getNumber("trackindex");
    let position = interaction.options.getNumber("targetindex");
    if (position >= queue.songs.length || position < 0) position = -1;
    if (songIndex > queue.songs.length - 1) {
      return client.embed(
        interaction,
        ` **A ultima musica da fila tem o index: \`${queue.songs.length}\`**`
      );
    } else if (position === 0) {
      return client.embed(
        interaction,
        `**Não pode mover para a posição antes do video atual!**`
      );
    } else {
      let song = queue.songs[songIndex];
      //remove the song
      queue.songs.splice(songIndex);
      //Add it to a specific Position
      queue.addToQueue(song, position);
      client.embed(
        interaction,
        `📑 Movido **${client.getTitle(
          song
        )}** para posição **\`${position}th\`** antes de **_${
          queue.songs[position - 1].name
        }_!**`
      );
    }
  },
};
