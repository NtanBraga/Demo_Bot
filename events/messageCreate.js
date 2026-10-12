const {
  cooldown,
  check_dj,
  databasing,
  getPermissionName,
} = require("../handlers/functions");
const client = require("..");
const { PREFIX: botPrefix, emoji } = require("../settings/config");
const { PermissionsBitField, EmbedBuilder, Events } = require("discord.js");

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild || !message.id) return;
  await databasing(message.guildId, message.author.id);
  let settings = await client.music.get(message.guild.id);
  let prefix = settings?.prefix || botPrefix;
  let mentionprefix = new RegExp(
    `^(<@!?${client.user.id}>|${escapeRegex(prefix)})\\s*`
  );
  if (!mentionprefix.test(message.content)) return;
  const [, nprefix] = message.content.match(mentionprefix);
  const args = message.content.slice(nprefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  if (cmd.length === 0) {
    if (nprefix.includes(client.user.id)) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(client.config.embed.color)
            .setDescription(
              ` ${emoji.SUCCESS} para ver todos meus comandos digite:  \`/help\``
            ),
        ],
      });
    }
  }
  const command =
    client.mcommands.get(cmd) ||
    client.mcommands.find((cmds) => cmds.aliases && cmds.aliases.includes(cmd));
  if (!command) return;
  if (command) {
    let queue = client.distube.getQueue(message.guild.id);
    let voiceChannel = message.member.voice.channel;
    let botChannel = message.guild.members.me.voice.channel;
    let checkDJ = await check_dj(client, message.member, queue?.songs[0]);

    if (
      !message.member.permissions.has(
        PermissionsBitField.resolve(command.userPermissions)
      )
    ) {
      const needPerms = getPermissionName(command.userPermissions);
      return client.embed(
        message,
        `Você não tem a permissão \`${needPerms}\` para usar o comando \`${command.name}\`!!`
      );
    } else if (
      !message.guild.members.me.permissions.has(
        PermissionsBitField.resolve(command.botPermissions)
      )
    ) {
      const needPerms = getPermissionName(command.botPermissions);
      return client.embed(
        message,
        `Eu não tenho a permissão \`${needPerms}\` para usar o comando \`${command.name}\`!!`
      );
    } else if (cooldown(message, command)) {
      return client.embed(
        message,
        ` Tu ta com cooldown, perai \`${cooldown(
          message,
          command
        ).toFixed()}\` Segundos`
      );
    } else if (command.inVoiceChannel && !voiceChannel) {
      return client.embed(
        message,
        `${emoji.ERROR} Você precisa entrar em um canal de voz`
      );
    } else if (
      command.inSameVoiceChannel &&
      botChannel &&
      !botChannel?.equals(voiceChannel)
    ) {
      return client.embed(
        message,
        `${emoji.ERROR} Você precisa entrar no canal ${botChannel}`
      );
    } else if (command.Player && !queue) {
      return client.embed(message, `${emoji.ERROR} Musica não tocando`);
    } else if (command.djOnly && checkDJ) {
      return client.embed(
        message,
        `${emoji.ERROR} Você não é o DJ e nem o requisitor..`
      );
    } else {
      command.run(client, message, args, nprefix, queue);
    }
  }
});

function escapeRegex(newprefix) {
  return newprefix.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`);
}
