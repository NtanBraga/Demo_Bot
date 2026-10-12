const {
  CommandInteraction,
  ChannelType,
  PermissionFlagsBits,
  ApplicationCommandType,
} = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "setupmusic",
  description: `Colocar canal fixo de musica`,
  userPermissions: PermissionFlagsBits.ManageChannels,
  botPermissions: PermissionFlagsBits.ManageChannels,
  category: "Settings",
  cooldown: 5,
  type: ApplicationCommandType.ChatInput,
  inVoiceChannel: false,
  inSameVoiceChannel: false,
  Player: false,
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
    let channel = await client.music.get(
      `${interaction.guild.id}.music.channel`
    );
    let oldChannel = interaction.guild.channels.cache.get(channel);

    if (oldChannel) {
      return client.embed(
        interaction,
        `** ${client.config.emoji.ERROR} Já tem um canal setado ${oldChannel}. Delete primeiro e tente de novo. **`
      );
    } else {
      interaction.guild.channels
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
            .send({ embeds: [client.queueembed(interaction.guild)] })
            .then(async (queuemsg) => {
              await ch
                .send({
                  embeds: [client.playembed(interaction.guild)],
                  components: client.buttons(true),
                })
                .then(async (playmsg) => {
                  await client.music.set(`${interaction.guild.id}.music`, {
                    channel: ch.id,
                    pmsg: playmsg.id,
                    qmsg: queuemsg.id,
                  });
                  client.embed(
                    interaction,
                    `${client.config.emoji.SUCCESS} Canal de musica: ${ch}`
                  );
                });
            });
        });
    }
  },
};
