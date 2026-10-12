const {
  Message,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "filter",
  aliases: ["fl", "filters"],
  description: `Colocar filtro`,
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

    const filters = Object.keys(client.config.filters);

    const row = new ActionRowBuilder().addComponents([
      new StringSelectMenuBuilder()
        .setCustomId("filter-menu")
        .setPlaceholder("Clique para selecionar filtro..")
        .addOptions(
          [
            {
              label: `Off`,
              description: `Clique para desabilitar filtro`,
              value: "off",
            },
            filters
              .filter((_, index) => index <= 22)
              .map((value) => {
                return {
                  label: value.toLocaleUpperCase(),
                  description: `Clique para setar filtro: ${value}`,
                  value: value,
                };
              }),
          ].flat(Infinity)
        ),
    ]);

    let msg = await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(client.config.embed.color)
          .setTitle(`Selecione para habilitar filtro...`)
          .setFooter(client.getFooter(message.author))
          .setDescription(
            `> Clique no dropdown para selecionar o filtro!!`
          ),
      ],
      components: [row],
    });
    const collector = await msg.createMessageComponentCollector({
      // filter: (i) => i.user.id === message.author.id,
      time: 60000 * 10,
    });
    collector.on("collect", async (interaction) => {
      if (interaction.isStringSelectMenu()) {
        await interaction.deferUpdate().catch((e) => {});
        if (interaction.customId === "filter-menu") {
          if (interaction.user.id !== message.author.id) {
            return interaction.followUp({
              content: `Você não é o autor desta interação`,
              ephemeral: true,
            });
          }
          let filter = interaction.values[0];
          if (filter === "off") {
            queue.filters.clear();
            interaction.followUp({
              content: `${client.config.emoji.SUCCESS} Filtro está off !!`,
              ephemeral: true,
            });
          } else {
            if (queue.filters.has(filter)) {
              queue.filters.remove(filter);
            } else {
              queue.filters.add(filter);
            }
            interaction.followUp({
              content: `${
                client.config.emoji.SUCCESS
              } | Filtro atual: \`${queue.filters.names.join(", ")}\``,
              ephemeral: true,
            });
          }
        }
      }
    });
  },
};
