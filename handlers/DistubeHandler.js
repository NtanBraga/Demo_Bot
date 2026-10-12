const { EmbedBuilder, Events, ChannelType } = require("discord.js");
const JUGNU = require("./Client");
const Store = require("./PlaylistStore");
const { check_dj, skip } = require("./functions");

/**
 *
 * @param {JUGNU} client
 */
module.exports = async (client) => {
  // interaction handling
  try {
    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.guild || interaction.user.bot) return;
      if (interaction.isButton()) {
        await interaction.deferUpdate().catch((e) => {});
        const { customId, member } = interaction;
        let voiceMember = interaction.guild.members.cache.get(member.id);
        let channel = voiceMember.voice.channel;
        let queue = client.distube.getQueue(interaction.guildId);
        let checkDJ = await check_dj(
          client,
          interaction.member,
          queue?.songs[0]
        );

        const refresh = (q, ms = 0) => {
          try {
            setTimeout(() => {
              client.updateplayer(q).catch(() => {});
            }, ms);
          } catch {}
        };

  switch (customId) {
          case "previous":
            {
              if (!channel) return send(interaction, ` ${client.config.emoji.ERROR} Você precisa entrar em um canal`);
              if (interaction.guild.members.me.voice.channel && !interaction.guild.members.me.voice.channel.equals(channel))
                return send(interaction, ` ${client.config.emoji.ERROR} Você precisa entrar no meu canal`);
              if (!queue) return send(interaction, ` ${client.config.emoji.ERROR} Eu não estou tocando agora`);
              if (checkDJ) return send(interaction, `${client.config.emoji.SUCCESS} Você não é o DJ e não é o requisitor da musica..`);
              try {
                await queue.previous();
                refresh(queue, 300);
                return send(interaction, `${client.config.emoji.SUCCESS}  Playing previous track`);
              } catch (e) {
                return send(interaction, `${client.config.emoji.ERROR} No previous track available`);
              }
            }
            break;
          case "rewind10":
            {
              if (!channel) return send(interaction, ` ${client.config.emoji.ERROR} Você precisa entrar em um canal`);
              if (interaction.guild.members.me.voice.channel && !interaction.guild.members.me.voice.channel.equals(channel))
                return send(interaction, ` ${client.config.emoji.ERROR} Você precisa entrar no meu canal`);
              if (!queue) return send(interaction, ` ${client.config.emoji.ERROR} Eu não estou tocando agora`);
              if (checkDJ) return send(interaction, `${client.config.emoji.SUCCESS} Você não é o DJ e não é o requisitor da musica..`);
              const pos = Math.max(0, (queue.currentTime || 0) - 10);
              try {
                await queue.seek(pos);
                refresh(queue, 200);
                return send(interaction, `${client.config.emoji.SUCCESS} Rewound 10s`);
              } catch {}
            }
            break;
          case "forward10":
            {
              if (!channel) return send(interaction, ` ${client.config.emoji.ERROR} Você precisa entrar em um canal`);
              if (interaction.guild.members.me.voice.channel && !interaction.guild.members.me.voice.channel.equals(channel))
                return send(interaction, ` ${client.config.emoji.ERROR} Você precisa entrar no meu canal`);
              if (!queue) return send(interaction, ` ${client.config.emoji.ERROR} Eu não estou tocando agora`);
              if (checkDJ) return send(interaction, `${client.config.emoji.SUCCESS} Você não é o DJ e não é o requisitor da musica..`);
              const duration = queue.songs[0]?.duration || 0;
              const pos = Math.min(duration - 1, (queue.currentTime || 0) + 10);
              try {
                await queue.seek(pos);
                refresh(queue, 200);
                return send(interaction, `${client.config.emoji.SUCCESS} Prosseguir 10s`);
              } catch {}
            }
            break;
          case "shuffle":
            {
              if (!channel) return send(interaction, ` ${client.config.emoji.ERROR} Você precisa entrar em um canal`);
              if (interaction.guild.members.me.voice.channel && !interaction.guild.members.me.voice.channel.equals(channel))
                return send(interaction, ` ${client.config.emoji.ERROR} Você precisa entrar no meu canal`);
              if (!queue) return send(interaction, ` ${client.config.emoji.ERROR} Eu não estou tocando agora`);
              if (checkDJ) return send(interaction, `${client.config.emoji.SUCCESS} You are not DJ and also you are not song requester..`);
              try {
                await queue.shuffle();
                refresh(queue, 0);
                return send(interaction, `${client.config.emoji.SUCCESS} Fila revirada`);
              } catch {}
            }
            break;
          case "autoplay":
            {
              if (!channel) {
                return send(
                  interaction,
                  `** ${client.config.emoji.ERROR} Você precisa entrar em um canal**`
                );
              } else if (
                interaction.guild.members.me.voice.channel &&
                !interaction.guild.members.me.voice.channel.equals(channel)
              ) {
                return send(
                  interaction,
                  ` ${client.config.emoji.ERROR} Você precisa entrar no meu canal`
                );
              } else if (!queue) {
                return send(
                  interaction,
                  ` ${client.config.emoji.ERROR} Eu não estou tocando agora`
                );
              } else if (checkDJ) {
                return send(
                  interaction,
                  `${client.config.emoji.SUCCESS} Você não é o DJ e não é o requisitor da musica..`
                );
              } else if (!queue.autoplay) {
                queue.toggleAutoplay();
                refresh(queue, 0);
                return send(
                  interaction,
                  ` ${client.config.emoji.SUCCESS} Autoplay Ativado !! `
                );
              } else {
                queue.toggleAutoplay();
                refresh(queue, 0);
                return send(
                  interaction,
                  ` ${client.config.emoji.SUCCESS} Autoplay esta desativado !!.`
                );
              }
            }
            break;
          case "skip":
            {
              if (!channel) {
                return send(
                  interaction,
                  ` ${client.config.emoji.ERROR} Você precisa entrar em um canal`
                );
              } else if (
                interaction.guild.members.me.voice.channel &&
                !interaction.guild.members.me.voice.channel.equals(channel)
              ) {
                return send(
                  interaction,
                  ` ${client.config.emoji.ERROR} Você precisa entrar no meu canal`
                );
              } else if (!queue) {
                return send(
                  interaction,
                  ` ${client.config.emoji.ERROR} Eu não estou tocando agora`
                );
              } else if (checkDJ) {
                return send(
                  interaction,
                  `${client.config.emoji.SUCCESS} Você não é o DJ e não é o requisitor da musica..`
                );
              } else {
                await skip(queue);
                refresh(queue, 300);
                return send(
                  interaction,
                  `${client.config.emoji.SUCCESS}  Musica pulada !!`
                );
              }
            }
            break;
          case "stop":
            {
              if (!channel) {
                return send(
                  interaction,
                  ` ${client.config.emoji.ERROR} Você precisa entrar em um canal`
                );
              } else if (
                interaction.guild.members.me.voice.channel &&
                !interaction.guild.members.me.voice.channel.equals(channel)
              ) {
                return send(
                  interaction,
                  ` ${client.config.emoji.ERROR} Você precisa entrar no meu canal`
                );
              } else if (!queue) {
                return send(
                  interaction,
                  ` ${client.config.emoji.ERROR} Eu não estou tocando agora`
                );
              } else if (checkDJ) {
                return send(
                  interaction,
                  `${client.config.emoji.SUCCESS} Você não é o DJ e não é o requisitor da musica..`
                );
              } else {
                await queue.stop().catch((e) => {});
                try {
                  const db = await client.music?.get(`${interaction.guildId}.vc`);
                  if (!db?.enable) await client.distube.voices.leave(interaction.guild);
                  // Reset embeds to default immediately
                  try {
                    await client.updateembed(client, interaction.guild);
                    await client.editPlayerMessage(queue.textChannel);
                  } catch {}
                } catch {}
                return send(
                  interaction,
                  ` ${client.config.emoji.SUCCESS} Video parado, saindo do canal...`
                );
              }
            }
            break;
          case "pauseresume":
            {
              if (!channel) {
                return send(
                  interaction,
                  ` ${client.config.emoji.ERROR} Você precisa entrar em alguma canal de voz.`
                );
              } else if (
                interaction.guild.members.me.voice.channel &&
                !interaction.guild.members.me.voice.channel.equals(channel)
              ) {
                return send(
                  interaction,
                  ` ${client.config.emoji.ERROR} Você precisa entrar no meu canal`
                );
              } else if (!queue) {
                return send(
                  interaction,
                  ` ${client.config.emoji.ERROR} estou tocando agora `
                );
              } else if (checkDJ) {
                return send(
                  interaction,
                  `${client.config.emoji.SUCCESS} Você não é o DJ e não é o requisitor da musica..`
                );
              } else if (queue.paused) {
                await queue.resume();
                refresh(queue, 0);
                return send(
                  interaction,
                  ` ${client.config.emoji.SUCCESS} Fila resumida!! `
                );
              } else if (!queue.paused) {
                await queue.pause();
                refresh(queue, 0);
                return send(
                  interaction,
                  ` ${client.config.emoji.SUCCESS} Fila pausada !! `
                );
              }
            }
            break;
          case "loop":
            {
              if (!channel) {
                return send(
                  interaction,
                  `${client.config.emoji.ERROR} Você precisa entrar em um canal`
                );
              } else if (
                interaction.guild.members.me.voice.channel &&
                !interaction.guild.members.me.voice.channel.equals(channel)
              ) {
                return send(
                  interaction,
                  `${client.config.emoji.ERROR} Você precisa entrar no meu canal`
                );
              } else if (!queue) {
                return send(
                  interaction,
                  `${client.config.emoji.ERROR} Eu não estou tocando agora`
                );
              } else if (checkDJ) {
                return send(
                  interaction,
                  `${client.config.emoji.SUCCESS} Você não é o DJ e não é o requisitor da musica..`
                );
              } else {
        switch (queue.repeatMode) {
                  case 0: // off
                    await queue.setRepeatMode(1);
          refresh(queue, 0);
                    return send(
                      interaction,
                      `${client.config.emoji.SUCCESS} Loop na musica ligado !!`
                    );
                  case 1: // song
                    await queue.setRepeatMode(2);
          refresh(queue, 0);
                    return send(
                      interaction,
                      `${client.config.emoji.SUCCESS} Loop de fila ligado !!`
                    );
                  case 2: // queue
                    await queue.setRepeatMode(0);
          refresh(queue, 0);
                    return send(
                      interaction,
                      `${client.config.emoji.SUCCESS} Loop Desligado !!`
                    );
                  default:
                    return send(
                      interaction,
                      `${client.config.emoji.ERROR} Modo de loop desconhecido`
                    );
                }
              }
            }
            break;

          case "savecurrent_btn":
            {
              // Validate context
              if (!channel) {
                return send(
                  interaction,
                  `${client.config.emoji.ERROR} Você precisa entrar no meu canal`
                );
              }
              if (
                interaction.guild.members.me.voice.channel &&
                !interaction.guild.members.me.voice.channel.equals(channel)
              ) {
                return send(
                  interaction,
                  `${client.config.emoji.ERROR} Você precisa entrar em meu canal`
                );
              }
              if (!queue || !queue.songs?.length) {
                return send(
                  interaction,
                  `${client.config.emoji.ERROR} Eu não estou tocando agora`
                );
              }

              // Open a private thread asking for playlist name
              const baseMsgId = client.temp.get(interaction.guildId);
              const baseMsg = baseMsgId
                ? await interaction.channel.messages.fetch(baseMsgId).catch(() => null)
                : null;
              const threadName = `save ▶ ${interaction.user.username}`.substring(0, 90);
              const starter = baseMsg || (await interaction.message?.fetch().catch(() => null)) || null;
              let thread;
              try {
                thread = await interaction.channel.threads.create({
                  name: threadName,
                  autoArchiveDuration: 60,
                  type: ChannelType.PrivateThread,
                  reason: `prompt da musica salvo para ${interaction.user.username}`,
                });
              } catch (e) {
                return send(
                  interaction,
                  `${client.config.emoji.ERROR} Eu preciso de permissão para criar topicos nesse chat.`
                );
              }
              // Invite only the clicker
              try { await thread.members.add(interaction.user.id).catch(() => {}); } catch {}
              await thread.send({
                content: `${interaction.user}, responda com o nome da playlist para salvar "${client.getTitle(queue.songs[0])}" (timeout 60s).`,
              });

              const collector = thread.createMessageCollector({
                time: 60_000,
                max: 1,
                filter: (m) => m.author.id === interaction.user.id,
              });

              collector.on("collect", async (m) => {
                const name = m.content.trim().slice(0, 64);
                const track = Store.serializeSong(queue.songs[0], interaction.user);
                await Store.create(client, interaction.guildId, interaction.user.id, name);
                await Store.addTracks(client, interaction.guildId, interaction.user.id, name, [track]);
                await thread.send(`${client.config.emoji.SUCCESS} Salvou para \`${name}\`. O topico vai se fechar em breve.`);
              });

              collector.on("end", async () => {
                setTimeout(() => thread.setArchived(true, "prompt salvo").catch(() => {}), 5000);
              });
            }
            break;

          default:
            break;
        }
      }
    });

    async function send(interaction, string) {
      interaction
        .followUp({
          embeds: [
            new EmbedBuilder()
              .setColor(client.config.embed.color)
              .setDescription(`> ${string.substring(0, 3000)}`)
              .setFooter(client.getFooter(interaction.user)),
          ],
          ephemeral: true,
        })
        .catch((e) => null);
    }
  } catch (e) {
    console.log(e);
  }
};
