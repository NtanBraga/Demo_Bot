const { Message, ChannelType, PermissionFlagsBits } = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "setupmusic",
  aliases: ["setmusic", "setup"],
  description: `Colocar canal fixo de musica`,
  userPermissions: PermissionFlagsBits.ManageGuild,
  botPermissions: PermissionFlagsBits.ManageChannels,
  category: "Settings",
  cooldown: 5,
  inVoiceChannel: false,
  inSameVoiceChannel: false,
  Player: false,
  djOnly: false,

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
    let channel = await client.music.get(`${message.guild.id}.music.channel`);
    let oldChannel = message.guild.channels.cache.get(channel);
    if (oldChannel) {
      return client.embed(
        message,
        `** ${client.config.emoji.ERROR} Já tem um canal setado ${oldChannel}. Delete primeiro e tente de novo. **`
      );
    } else {
      message.guild.channels
        .create({
          name: `${client.user.username}-requests`,
          type: ChannelType.GuildText,
          rateLimitPerUser: 3,
          reason: `Gerencia do canal de musicas.`,
          topic: `Canal de musica para ${client.user.username}. Por favor coloque nome ou link da musica.`,
          permissionOverwrites: [
            {
              id: client.user.id,
              allow: [
                "ManageMessages",
                "ManageChannels",
                "SendMessages",
                "EmbedLinks",
                "ReadMessageHistory",
                "UseExternalEmojis",
                "ViewChannel",
                "CreatePublicThreads",
                "CreatePrivateThreads",
                "SendMessagesInThreads",
              ],
            },
          ],
        })
        .then(async (ch) => {
          await ch
            .send({ embeds: [client.queueembed(message.guild)] })
            .then(async (queuemsg) => {
              await ch
                .send({
                  embeds: [client.playembed(message.guild)],
                  components: client.buttons(true),
                })
                .then(async (playmsg) => {
                  await client.music.set(`${message.guild.id}.music`, {
                    channel: ch.id,
                    pmsg: playmsg.id,
                    qmsg: queuemsg.id,
                  });
                  client.embed(
                    message,
                    `${client.config.emoji.SUCCESS} Canal de musica: ${ch}`
                  );
                });
            });
        });
    }
  },
};
