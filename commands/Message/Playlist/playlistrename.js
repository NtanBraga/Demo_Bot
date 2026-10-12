const { Message, PermissionFlagsBits } = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const Store = require("../../../handlers/PlaylistStore");

module.exports = {
  name: "playlistrename",
  aliases: ["plrename"],
  description: `Renomeie uma de suas playlists`,
  userPermissions: PermissionFlagsBits.SendMessages,
  botPermissions: PermissionFlagsBits.SendMessages,
  category: "Playlist",
  cooldown: 3,
  run: async (client, message, args) => {
    const oldName = (args.shift() || "").trim();
    const newName = args.join(" ").trim();
    if (!oldName || !newName) return client.embed(message, `${client.config.emoji.ERROR} Uso: playlistrename <old> <new>`);
    const ok = await Store.rename(client, message.guild.id, message.author.id, oldName, newName);
    if (!ok) return client.embed(message, `${client.config.emoji.ERROR} Não pode renomear. Cheque nomes ou nomes novos não estão sendo usados.`);
    return client.embed(message, `${client.config.emoji.SUCCESS} Renomeado \`${oldName}\` para \`${newName}\`.`);
  },
};
