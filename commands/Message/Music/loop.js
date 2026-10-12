const { Message, PermissionFlagsBits } = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "loop",
  aliases: ["lp", "lop"],
  description: `Ativar modo de repetição Video/Fila`,
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
    let loopmode = args[0];
    let mods = ["song", "s", "queue", "q", "off"];
    if (!mods.includes(loopmode)) {
      return client.embed(
        message,
        `Uso errado :: \`\`\`${mods.join(" ' ")}\`\`\``
      );
    }
    if (loopmode === "off") {
      await queue.setRepeatMode(0);
      return client.embed(
        message,
        `** ${client.config.emoji.ERROR} Loop desabilitado!! **`
      );
    } else if (loopmode === "song" || loopmode === "s") {
      await queue.setRepeatMode(1);
      return client.embed(
        message,
        `** ${client.config.emoji.SUCCESS} Loop de musica abilitado!! **`
      );
    } else if (loopmode === "queue" || loopmode === "q") {
      await queue.setRepeatMode(2);
      return client.embed(
        message,
        `** ${client.config.emoji.SUCCESS} Loop de fila abilitado!! **`
      );
    }
  },
};
