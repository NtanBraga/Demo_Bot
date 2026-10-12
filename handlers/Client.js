const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  User,
  EmbedBuilder,
} = require("discord.js");
const fs = require("fs");
const Distube = require("distube").default;
const { SpotifyPlugin } = require("@distube/spotify");
const { SoundCloudPlugin } = require("@distube/soundcloud");
const { filters, options } = require("../settings/config");
const { CustomYtDlpPlugin, fetchFastStreamUrl } = require("./YtDlpPlugin");
const { searchCache, metadataCache, singleFlight } = require("./Cache");

class JUGNU extends Client {
  constructor() {
    super({
      partials: [
        Partials.Channel,
        Partials.GuildMember,
        Partials.Message,
        Partials.User,
      ],
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
      shards: "auto",
      failIfNotExists: false,
      allowedMentions: {
        parse: ["everyone", "roles", "users"],
        users: [],
        roles: [],
        repliedUser: false,
      },
    });

    this.events = new Collection();
    this.cooldowns = new Collection();
    this.mcommands = new Collection();
    this.commands = new Collection();
    this.aliases = new Collection();
    this.shuffleData = new Collection();
    this.leaveTimeoutHandles = new Collection();
    this.mcategories = fs.readdirSync("./Commands/Message");
    this.scategories = fs.readdirSync("./Commands/Slash");
    this.temp = new Collection();
    this.config = require("../settings/config");
    this.distube = new Distube(this, {
      emitNewSongOnly: true, // Emit 'playSong' event only when a new song starts playing
      nsfw: false, // Enable nsfw mode for searching
      savePreviousSongs: true, // Save previous songs in the queue
      joinNewVoiceChannel: false, // Join the new voice channel when a song is played
      // Additional options
      customFilters: filters, // Use custom filters if needed
      // Plugins configuration
      plugins: [
        new SpotifyPlugin(),
        new SoundCloudPlugin(),
        new CustomYtDlpPlugin(),
      ],
    });

    const ytSearch = require("yt-search");

    const fastSearch = async (query) => {
      try {
        const res = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: {
              client: { clientName: "WEB", clientVersion: "2.20240401.01.00", hl: "en", gl: "US" },
            },
            query,
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
        for (const s of sections) {
          const items = s.itemSectionRenderer?.contents || [];
          for (const item of items) {
            const v = item.videoRenderer;
            if (v && v.videoId) {
              const title = v.title?.runs?.[0]?.text || v.title?.simpleText;
              const durStr = v.lengthText?.runs?.[0]?.text || v.lengthText?.simpleText || "0:00";
              return {
                title,
                url: `https://www.youtube.com/watch?v=${v.videoId}`,
                videoId: v.videoId,
                id: v.videoId,
                thumbnail: v.thumbnail?.thumbnails?.[0]?.url,
                author: { name: v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || "YouTube" },
                duration: durStr,
                timestamp: durStr,
                views: v.viewCountText?.simpleText || 0,
              };
            }
          }
        }
      } catch (_) {}
      return null;
    };

    this.resolveQuery = async (query) => {
      if (typeof query !== "string") return query;
      const trimmed = query.trim();
      if (/^(https?:\/\/)/i.test(trimmed)) {

        const isPlaylist = trimmed.includes("/playlist") || /[?&]list=/i.test(trimmed)

        if(!isPlaylist){
          fetchFastStreamUrl(trimmed).catch(() => null);
        }
        
        return trimmed;
      }
      const clean = trimmed.replace(/^ytsearch[0-9]*:/i, "").trim();
      const cacheKey = clean.toLowerCase();
      const cached = searchCache.get(cacheKey);
      if (cached) {
        fetchFastStreamUrl(cached.url).catch(() => null);
        return cached.url;
      }

      return singleFlight.do(`search:${cacheKey}`, async () => {
        try {
          let top = await fastSearch(clean);
          if (!top) {
            const res = await ytSearch(clean);
            if (res && res.videos && res.videos.length > 0) {
              top = res.videos[0];
            }
          }
          if (top) {
            metadataCache.set(top.url, top);
            searchCache.set(cacheKey, top);
            fetchFastStreamUrl(top.url).catch(() => null);
            return top.url;
          }
        } catch (e) {
          console.error("[Search] Query resolution failed:", e);
        }
        return trimmed;
      });
    };

    const originalPlay = this.distube.play.bind(this.distube);
    this.distube.play = async (voiceChannel, song, options = {}) => {
      let resolvedSong = song;
      if (typeof song === "string") {
        resolvedSong = await this.resolveQuery(song);
      }
      return originalPlay(voiceChannel, resolvedSong, options);
    };

    this.distube.search = async (query, options = {}) => {
      const clean = (typeof query === "string" ? query : "")
        .trim()
        .replace(/^ytsearch[0-9]*:/i, "")
        .trim();
      try {
        const res = await ytSearch(clean);
        if (res && res.videos && res.videos.length > 0) {
          return res.videos.slice(0, options.limit || 10).map((v) => ({
            name: v.title,
            url: v.url,
            formattedDuration: v.timestamp,
            thumbnail: v.thumbnail,
            uploader: { name: v.author?.name },
            views: v.views,
          }));
        }
      } catch (e) {
        console.error("[yt-search] Search failed:", e);
      }
      return [];
    };
  }

  start(token) {
    [
      "handler",
      "DistubeEvents",
      "RequestChannel",
      "DistubeHandler",
      "utils",
    ].forEach((handler) => {
      require(`./${handler}`)(this);
    });
    this.login(token);
  }
  /**
   *
   * @param {User} user
   * @returns
   */
  getFooter(user) {
    const obj = {
      text: `Pedido por ${user.username}`,
      iconURL: user.displayAvatarURL(),
    };

    return options.embedFooter ? obj : null;
  }

  embed(interaction, data) {
    let user = interaction.user ? interaction.user : interaction.author;
    if (interaction.deferred) {
      interaction
        .followUp({
          embeds: [
            new EmbedBuilder()
              .setColor(this.config.embed.color)
              .setDescription(`${data.substring(0, 3000)}`)
              .setFooter(this.getFooter(user)),
          ],
        })
        .catch((e) => {});
    } else {
      interaction
        .reply({
          embeds: [
            new EmbedBuilder()
              .setColor(this.config.embed.color)
              .setDescription(`${data.substring(0, 3000)}`)
              .setFooter(this.getFooter(user)),
          ],
        })
        .catch((e) => {});
    }
  }
}

module.exports = JUGNU;
