const client = require("../index");
const {
  cooldown,
  check_dj,
  databasing,
  getPermissionName,
} = require("../handlers/functions");
const { emoji } = require("../settings/config");
const { ApplicationCommandOptionType, Events } = require("discord.js");

client.on(Events.InteractionCreate, async (interaction) => {
  // Autocomplete Handling
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (cmd && typeof cmd.autocomplete === "function") {
      try {
        await cmd.autocomplete(client, interaction);
      } catch (e) {
        // swallow
      }
    }
    return;
  }

  // Slash Command Handling
  if (interaction.isCommand()) {
    await interaction.deferReply().catch((e) => {});
    await databasing(interaction.guildId, interaction.user.id);

    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) {
      return client.embed(
        interaction,
        `${emoji.ERROR} \`${interaction.commandName}\` Comando não encontrado `
      );
    }
    const args = [];
    for (let option of interaction.options.data) {
      if (option.type === ApplicationCommandOptionType.Subcommand) {
        if (option.name) args.push(option.name);
        option.options?.forEach((x) => {
          if (x.value) args.push(x.value);
        });
      } else if (option.value) args.push(option.value);
    }

    if (cmd) {
      // checking user perms
      let queue = client.distube.getQueue(interaction.guild.id);
      let voiceChannel = interaction.member.voice.channel;
      let botChannel = interaction.guild.members.me.voice.channel;
      let checkDJ = await check_dj(client, interaction.member, queue?.songs[0]);

      if (!interaction.member.permissions.has(cmd.userPermissions)) {
        const needPerms = getPermissionName(cmd.userPermissions);
        return client.embed(
          interaction,
          `Você não tem a permissão \`${needPerms}\` para usar o comando \`${cmd.name}\`!!`
        );
      } else if (
        !interaction.guild.members.me.permissions.has(cmd.botPermissions)
      ) {
        const needPerms = getPermissionName(cmd.botPermissions);
        return client.embed(
          interaction,
          `Eu não tenho a permissão \`${needPerms}\` para usar o comando \`${cmd.name}\`!!`
        );
      } else if (cooldown(interaction, cmd)) {
        return client.embed(
          interaction,
          ` Tu ta com cooldown, perai \`${cooldown(
            interaction,
            cmd
          ).toFixed()}\` Segundos`
        );
      } else if (cmd.inVoiceChannel && !voiceChannel) {
        return client.embed(
          interaction,
          `${emoji.ERROR} Você precisa entrar em um canal de voz`
        );
      } else if (
        cmd.inSameVoiceChannel &&
        botChannel &&
        !botChannel?.equals(voiceChannel)
      ) {
        return client.embed(
          interaction,
          `${emoji.ERROR} Você precisa entrar no canal ${botChannel}`
        );
      } else if (cmd.Player && !queue) {
        return client.embed(interaction, `${emoji.ERROR} Nenhuma musica tocando`);
      } else if (cmd.djOnly && checkDJ) {
        return client.embed(
          interaction,
          `${emoji.ERROR} Você não é o DJ e nem o requisitor..`
        );
      } else {
        await interaction.deferReply().catch((e) => {});
        await cmd.run(client, interaction, args, queue);
      }
    }
  }

  // Context Menu Handling
  if (interaction.isContextMenuCommand()) {
    await interaction.deferReply({ ephemeral: true }).catch((e) => {});
    const command = client.commands.get(interaction.commandName);
    if (command) command.run(client, interaction);
  }

  // button handling
  if (interaction.isButton()) {
    await interaction.deferUpdate().catch((e) => {});
  }
  // menu handling
  if (interaction.isAnySelectMenu()) {
    await interaction.deferUpdate().catch((e) => {});
  }
});
