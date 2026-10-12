const { Message, PermissionFlagsBits } = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "play",
  aliases: ["p", "song"],
  description: `Coloque Nome ou Link`,
  userPermissions: PermissionFlagsBits.Connect,
  botPermissions: PermissionFlagsBits.Connect,
  category: "Music",
  cooldown: 5,
  inVoiceChannel: true,
  inSameVoiceChannel: true,
  Player: false,
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
    const song = args.join(" ");

    if (!song) {
      return client.embed(
        message,
        `${client.config.emoji.ERROR} Por favor coloque o nome ou link.`
      );
    } else {
      let { channel } = message.member.voice;
      const hqMode = (await client.music.get(`${message.guildId}.hqmode`)) || false;
      // Pre-join voice to parallelize Discord voice handshake with search/resolve
      try {
        await client.distube.voices.join(channel);
      } catch {}

      try {
        await client.distube.play(channel, song, {
          member: message.member,
          textChannel: message.channel,
          message: message,
          ...(hqMode ? { volume: 100 } : {}),
        });
      } catch (err) {
        client.embed(
          message,
          `${client.config.emoji.ERROR} Falha ao tocar: \`${err.message || err}\``
        );
      }

      await message.delete().catch((err) => {});
    }
  },
};
