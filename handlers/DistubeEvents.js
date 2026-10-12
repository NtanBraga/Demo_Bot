const { EmbedBuilder, Events } = require("discord.js");
const JUGNU = require("./Client");
const AutoresumeHandler = require("./AutoresumeHandler");
const InitAutoResume = require("./InitAutoResume");

/**
 *
 * @param {JUGNU} client
 */
module.exports = async (client) => {
  client.on(Events.ClientReady, async () => {
    const delay = client.ws.ping > 0 ? 2 * client.ws.ping : 1000;
    setTimeout(async () => await AutoresumeHandler(client), delay);
  });

  // events
  client.distube.on("playSong", async (queue, song) => {
    let data = await client.music.get(`${queue.textChannel.guildId}.music`);
    if (data) {
      await client.updatequeue(queue);
      await client.updateplayer(queue);
      if (data.channel === queue.textChannel.id) return;
    }

    const barLength = 20;
    const progressBar = song.isLive 
      ? "🔴 \`AO VIVO\`" 
      : `[🔘${"▬".repeat(barLength - 1)}]`;

    queue.textChannel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(client.config.embed.color)
            .setAuthor({
              name: `Tocando agora`,
              iconURL: `https://raw.githubusercontent.com/SudhanPlayz/Discord-MusicBot/master/assets/logo.gif`
            })
            .setImage(song.thumbnail)
            .setDescription(`**[${client.getTitle(song)}](${song.url})**\n\n\`00:00\` ${progressBar} \`${song.formattedDuration}\`\n\n**Status:**\n> \`${client.status(queue)}\``)
            .addFields([
              {
                name: `**Requerido por**`,
                value: `\`${song.user.username}\``,
                inline: true,
              },
              {
                name: `**Autor**`,
                value: `\`${song.uploader.name}\``,
                inline: true,
              },
              {
                name: `**Views**`,
                value: `\`${song.views > 0 ? song.views.toLocaleString() : "N/A"}\``,
                inline: true,
              },
            ])
            .setFooter(client.getFooter(song.user)),
        ],
        components: client.buttons(false, queue),
      })
      .then((msg) => {
        client.temp.set(queue.textChannel.guildId, msg.id);
      })
      .catch((e) => null);
  });

  client.distube.on("addSong", async (queue, song) => {
    let data = await client.music.get(`${queue.textChannel.guildId}.music`);
    if (data) {
      await client.updatequeue(queue);
      await client.updateplayer(queue);
      if (data.channel === queue.textChannel.id) return;
    }

    const activatePlayerId = client.temp.get(queue.textChannel.guildId)
    if(activatePlayerId){
      queue.textChannel.messages.fetch(activatePlayerId).then(msg => {
        if(msg) msg.edit({ components: client.buttons(false, queue)}).catch(() => {})
      }).catch(() => {})
    }

    queue.textChannel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(client.config.embed.color)
            .setAuthor({
              name: `Adicionado a fila`,
              iconURL: song.user.displayAvatarURL({ dynamic: true }),
              url: song.url,
            })
            .setThumbnail(song.thumbnail)
            .setDescription(`**[${client.getTitle(song)}](${song.url})**`)
            .addFields([
              {
                name: `**Requerido por**`,
                value: `\`${song.user.tag}\``,
                inline: true,
              },
              {
                name: `**Autor**`,
                value: `\`${song.uploader.name}\``,
                inline: true,
              },
              {
                name: `**Duração**`,
                value: `\`${song.formattedDuration}\``,
                inline: true,
              },
            ])
            .setFooter(client.getFooter(song.user)),
        ],
      })
      .then((msg) => {
        setTimeout(() => {
          msg.delete().catch((e) => null);
        }, 10000);
      })
      .catch((e) => null);
  });

  client.distube.on("addList", async (queue, playlist) => {
    let data = await client.music.get(`${queue.textChannel.guildId}.music`);
    if (data) {
      await client.updatequeue(queue);
      await client.updateplayer(queue);
      if (data.channel === queue.textChannel.id) return;
    }

    const activatePlayerId = client.temp.get(queue.textChannel.guildId)
    if(activatePlayerId){
      queue.textChannel.messages.fetch(activatePlayerId).then(msg => {
        if(msg) msg.edit({components: client.buttons(false, queue)}).catch(() => {})
      }).catch(() => {})
    }

    queue.textChannel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(client.config.embed.color)
            .setAuthor({
              name: `Playlist Adicionada a Fila`,
              iconURL: playlist.user.displayAvatarURL({ dynamic: true }),
              url: playlist.url,
            })
            .setThumbnail(playlist.thumbnail)
            .setDescription(`** [\`${playlist.name}\`](${playlist.url}) **`)
            .addFields([
              {
                name: `**Requerido por**`,
                value: `\`${playlist.user.tag}\``,
                inline: true,
              },
              {
                name: `**Musicas**`,
                value: `\`${playlist.songs.length}\``,
                inline: true,
              },
              {
                name: `**Duração Total**`,
                value: `\`${playlist.formattedDuration}\``,
                inline: true,
              },
            ])
            .setFooter(client.getFooter(playlist.user)),
        ],
      })
      .then((msg) => {
        setTimeout(() => {
          msg.delete().catch((e) => null);
        }, 10000);
      })
      .catch((e) => null);
  });

  client.distube.on("disconnect", async (queue) => {
    try {
      const guildId = queue.textChannel.guildId;

      // Remove auto-resume entry
      await client.autoresume.delete(guildId);

      // Edit player message
      await client.editPlayerMessage(queue.textChannel);

      // Update embed
      await client.updateembed(client, queue.textChannel.guild);

      // Check if auto-joining is enabled in the database
      const db = await client.music?.get(`${guildId}.vc`);
      const data = await client.music.get(`${guildId}.music`);

      if (!db?.enable && data && data.channel !== queue.textChannel.id) {
        // If auto-joining is disabled and the current queue channel does not match the disconnected channel
        const embed = new EmbedBuilder()
          .setColor(client.config.embed.color)
          .setDescription(
            `> O bot foi desconectado do canal de voz.`
          );

        const msg = await queue.textChannel.send({ embeds: [embed] });
        setTimeout(() => msg.delete().catch(() => {}), 3000);
      } else if (db?.enable) {
        // If auto-joining is enabled, rejoin the voice channel
        await client.joinVoiceChannel(queue.textChannel.guild);
      }
    } catch (error) {
      console.error("An error occurred in disconnect event:", error);
    }
  });

  client.distube.on("error", async (error, queue, song) => {
    console.error(`[DisTube Error]:`, error);
    if (queue?.textChannel) {
      queue.textChannel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(client.config.embed.color)
              .setTitle(`Erro encontrado...`)
              .setDescription(String(error).substring(0, 3000)),
          ],
        })
        .then((msg) => {
          setTimeout(() => {
            msg.delete().catch((e) => null);
          }, 5000);
        })
        .catch((e) => {});
    }
  });

  client.distube.on("noRelated", async (queue) => {
    if (queue?.textChannel) {
      queue.textChannel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(client.config.embed.color)
              .setTitle(`Nenhuma musica relacioada pelo nome de \`${queue?.songs[0]?.name}\``),
          ],
        })
        .then((msg) => {
          setTimeout(() => {
            msg.delete().catch((e) => null);
          }, 5000);
        })
        .catch((e) => {});
    }
  });

  client.distube.on("finishSong", async (queue, song) => {
    await client.editPlayerMessage(queue.textChannel);
    await client.updatequeue(queue);
    await client.updateplayer(queue);
  });

  client.distube.on("finish", async (queue) => {
    await client.updateembed(client, queue.textChannel.guild);
    await client.editPlayerMessage(queue.textChannel);
    // Remove auto-resume entry
    await client.autoresume.delete(queue.textChannel.guild.id);

    // Leave voice channel if 24/7 is disabled
    try {
      const db = await client.music?.get(`${queue.textChannel.guild.id}.vc`);
      if (!db?.enable) {
        await client.distube.voices.leave(queue.textChannel.guild);
      }
    } catch (e) {
      // ignore leave errors
    }

    if (queue.textChannel) {
      queue.textChannel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(client.config.embed.color)
              .setDescription(`Fila terminada, sem musica para tocar.`),
          ],
        })
        .then((msg) => {
          setTimeout(() => {
            msg.delete().catch((e) => null);
          }, 5000);
        })
        .catch((e) => {});
    }
  });

  client.distube.on("initQueue", async (queue) => {
    queue.volume = client.config.options.defaultVolume;

    // init auto resume for the queue
    await InitAutoResume(client, queue);
  });

  client.distube.on("searchCancel", async (message, quary) => {
    message.channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(client.config.embed.color)
            .setDescription(`Não consigo procurar \`${quary}\``),
        ],
      })
      .then((msg) => {
        setTimeout(() => {
          msg.delete().catch((e) => null);
        }, 5000);
      });
  });

  client.distube.on("searchNoResult", async (message, quary) => {
    message.channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(client.config.embed.color)
            .setDescription(
              `${client.config.emoji.ERROR} Nenhum resultado para \`${quary}\`!`
            ),
        ],
      })
      .then((msg) => {
        setTimeout(() => {
          msg.delete().catch((e) => null);
        }, 5000);
      });
  });
};
