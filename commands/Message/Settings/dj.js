const { Message, PermissionFlagsBits } = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "dj",
  aliases: ["setupdj"],
  description: `DJ ON/OFF`,
  userPermissions: PermissionFlagsBits.ManageGuild,
  botPermissions: PermissionFlagsBits.ManageGuild,
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
    let options = args[0];
    switch (options) {
      case "enable":
        {
          let role =
            message.mentions.roles.first() ||
            message.guild.roles.cache.get(args[1]);
          if (!role) {
            return client.embed(
              message,
              `${client.config.emoji.ERROR} Por favor coloque um Cargo ID ou Mensão`
            );
          } else {
            await client.music.set(`${message.guild.id}.djrole`, role.id);
            client.embed(
              message,
              `${client.config.emoji.SUCCESS} ${role} Cargo adicionado para DJ Cargo`
            );
          }
        }
        break;
      case "disable":
        {
          await client.music.set(`${message.guild.id}.djrole`, null);
          client.embed(
            message,
            `${client.config.emoji.SUCCESS} DJ Desabilitado`
          );
        }
        break;
      case "cmds":
        {
          const djcommands = client.mcommands
            .filter((cmd) => cmd?.djOnly)
            .map((cmd) => cmd.name)
            .join(", ");

          client.embed(
            message,
            `**DJ Commands** \n \`\`\`js\n${djcommands}\`\`\``
          );
        }
        break;

      default:
        {
          client.embed(
            message,
            `** ${client.config.emoji.ERROR} Uso errado **  \n\n \`${prefix}dj abilita <@role>\` \n\n \`${prefix}dj desabilita\`  \n\n \`${prefix}dj cmds\` `
          );
        }
        break;
    }
  },
};
