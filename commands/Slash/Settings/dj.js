const {
  CommandInteraction,
  ApplicationCommandOptionType,
  PermissionFlagsBits,
  ApplicationCommandType,
} = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "dj",
  description: `DJ ON/OFF`,
  userPermissions: PermissionFlagsBits.ManageGuild,
  botPermissions: PermissionFlagsBits.ManageGuild,
  category: "Settings",
  cooldown: 5,
  type: ApplicationCommandType.ChatInput,
  inVoiceChannel: false,
  inSameVoiceChannel: false,
  Player: false,
  djOnly: false,
  options: [
    {
      name: "enable",
      description: `Habilite DJ no seu servidor`,
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: "role",
          description: `Mencione o cargo de DJ`,
          type: ApplicationCommandOptionType.Role,
          required: true,
        },
      ],
    },
    {
      name: "disable",
      description: `Desabilite DJ no seu servidor`,
      type: ApplicationCommandOptionType.Subcommand,
    },
    {
      name: "commands",
      description: `Mostre todos slash commands`,
      type: ApplicationCommandOptionType.Subcommand,
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
    let options = interaction.options.getSubcommand();
    switch (options) {
      case "enable":
        {
          let role = interaction.options.getRole("role");
          await client.music.set(`${interaction.guild.id}.djrole`, role.id);
          client.embed(
            interaction,
            `${client.config.emoji.SUCCESS} ${role} Cargo adicionado para DJ`
          );
        }
        break;
      case "disable":
        {
          await client.music.set(`${interaction.guild.id}.djrole`, null);
          client.embed(
            interaction,
            `${client.config.emoji.SUCCESS} DJ Desabilitado`
          );
        }
        break;
      case "commands":
        {
          const djcommands = client.commands
            .filter((cmd) => cmd?.djOnly)
            .map((cmd) => cmd.name)
            .join(", ");

          client.embed(
            interaction,
            `**Comandos DJ** \n \`\`\`js\n${djcommands}\`\`\``
          );
        }
        break;

      default:
        break;
    }
  },
};
