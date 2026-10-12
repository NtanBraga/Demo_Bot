const {
  CommandInteraction,
  PermissionFlagsBits,
  ApplicationCommandType,
  Colors,
} = require("discord.js");
const JUGNU = require("../../../handlers/Client");
const { Queue } = require("distube");

module.exports = {
  name: "ping",
  description: `Veja a latencia e ping do bot`,
  userPermissions: PermissionFlagsBits.SendMessages,
  botPermissions: PermissionFlagsBits.EmbedLinks,
  category: "Information",
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
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const startTime = Date.now();

    // Send an initial message to calculate latencies
    const tempMessage = await interaction.followUp({
      embeds: [
        {
          description: "🔍 **Calculando ping...**",
          color: Colors.Blurple,
          footer: { text: "Por favor espere um pouco..." },
        },
      ],
    });

    // Calculating latencies
    const messageLatency =
      tempMessage.createdTimestamp - interaction.createdTimestamp; // Message latency
    const botLatency = Date.now() - startTime; // Bot processing latency
    const apiLatency = Math.max(Math.round(client.ws.ping), 0); // Ensure no negative API latency
    const totalLatency = botLatency + apiLatency; // Total latency

    // Edit the initial reply with latency details
    await interaction.editReply({
      embeds: [
        {
          title: "🏓 **Pong!**",
          description: "Aqui esta os detalhes da latencia:",
          color: Colors.Gold,
          fields: [
            {
              name: "🤖 **Latencia do Bot**",
              value: `\`${formatMilliseconds(botLatency)}\``,
              inline: true,
            },
            {
              name: "💬 **Latencia da Mensagem**",
              value: `\`${formatMilliseconds(messageLatency)}\``,
              inline: true,
            },
            {
              name: "📡 **Latencia da API**",
              value: `\`${formatMilliseconds(apiLatency)}\``,
              inline: true,
            },
            {
              name: "🌍 **Latencia do Total**",
              value: `\`${formatMilliseconds(totalLatency)}\``,
              inline: false,
            },
          ],
          thumbnail: {
            url: "https://i.imgur.com/AfFp7pu.png", // Thumbnail image URL
          },
          footer: {
            text: "Bot status: Online ⚡ | Todos pings calculados em milisegundos (ms)",
            icon_url: client.user.displayAvatarURL(),
          },
          timestamp: new Date(), // Adds timestamp of when the ping was measured
        },
      ],
    });
  },
};

// Function to format milliseconds into a readable string
function formatMilliseconds(ms) {
  return `${ms}ms`;
}
