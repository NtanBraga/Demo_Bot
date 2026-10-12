const {
  CommandInteraction,
  PermissionFlagsBits,
  ApplicationCommandType,
  ApplicationCommandOptionType,
} = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "play",
  description: `Coloque Nome ou Link`,
  userPermissions: PermissionFlagsBits.Connect,
  botPermissions: PermissionFlagsBits.Connect,
  category: "Music",
  cooldown: 5,
  type: ApplicationCommandType.ChatInput,
  inVoiceChannel: true,
  inSameVoiceChannel: true,
  Player: false,
  djOnly: false,
  options: [
    {
      name: "song",
      description: `Nome/Link da musica`,
      type: ApplicationCommandOptionType.String,
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
    let song = interaction.options.getString("song");
    let { channel } = interaction.member.voice;
    const hqMode = (await client.music.get(`${interaction.guildId}.hqmode`)) || false;
    // Pre-join voice to parallelize connection with source resolution
    try {
      await client.distube.voices.join(channel);
    } catch {}

    try {
      await client.distube.play(channel, song, {
        member: interaction.member,
        textChannel: interaction.channel,
        ...(hqMode ? { volume: 100 } : {}),
      });
    } catch (err) {
      return interaction
        .followUp({
          content: `${client.config.emoji.ERROR} Falha ao tocar: \`${err.message || err}\``,
          ephemeral: true,
        })
        .catch(() => {});
    }

    interaction
      .followUp({
        content: `Procurando \`${song}\``,
        ephemeral: true,
      })
      .then((msg) => {
        setTimeout(() => {
          msg.delete().catch((e) => {});
        }, 3000);
      });
  },
};
