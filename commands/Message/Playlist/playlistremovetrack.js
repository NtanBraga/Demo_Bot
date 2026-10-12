const { Message, PermissionFlagsBits } = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const Store = require("../../../handlers/PlaylistStore");

module.exports = {
  name: "playlistremovetrack",
  aliases: ["plremovetrack", "plrm"],
  description: `Remover uma musica da playlist por index (base-1)`,
  userPermissions: PermissionFlagsBits.SendMessages,
  botPermissions: PermissionFlagsBits.SendMessages,
  category: "Playlist",
  cooldown: 3,
  inVoiceChannel: false,
  inSameVoiceChannel: false,
  Player: false,
  djOnly: false,
  run: async (client, message, args) => {
    const name = args.shift();
    const idx = Number(args.shift());
    if (!name || !idx) return client.embed(message, `${client.config.emoji.ERROR} Uso: \`${client.config.PREFIX}playlistremovetrack <name> <index>\``);
    const pl = await Store.get(client, message.guild.id, message.author.id, name);
    if (!pl) return client.embed(message, `${client.config.emoji.ERROR} Playlist não encontrada. `);
    const removed = await Store.removeTrack(client, message.guild.id, message.author.id, pl.name, idx);
    if (!removed) return client.embed(message, `${client.config.emoji.ERROR} Index inválida. `);
    return client.embed(message, `${client.config.emoji.SUCCESS} Removida \`${removed.name}\` de \`${pl.name}\`.`);
  },
};
