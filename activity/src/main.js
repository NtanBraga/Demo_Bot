import './assets/css/style.css'
import { DiscordSDK } from "@discord/embedded-app-sdk"
import { montarPlayerWebRTC } from './webrtcActivityPlayer'
import { montarParticipantesDiscord } from './discordParticipants'

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID

document.querySelector('#app').innerHTML = `
  <main>
    <header class="app-header">
      <div class="app-brand">
        <h1>Demo Live</h1>
        <h2>Compartilhamento de tela</h2>
      </div>

      <div
        id="discord-participants"
        class="discord-participants"
        role="group"
        aria-label="Participantes da Activity"
      ></div>

      <p id="discord-status" data-state="connecting" role="status" aria-live="polite">
        Conectando ao Discord...
      </p>
  </header>
  </main>
`

const discordStatus = document.getElementById("discord-status")

async function iniciarActivity(){
  try{

    const params = new URLSearchParams(window.location.search)

    if(!params.has("frame_id")) {
      discordStatus.textContent = "Modo navegador: abra esta Activity pelo Discord"
      console.log("[Atividade] Executando fora do discord")

      return
    }

    if(!CLIENT_ID) throw new Error("ClientID não configurado.")

    const discordSDK = new DiscordSDK(CLIENT_ID)

    await discordSDK.ready()

    discordStatus.dataset.state = 'connected'
    discordStatus.textContent = "Discord conectado"
    console.log("[Atividade] SDK conectado.")
    console.log("[Atividade] Channel ID: ", discordSDK.channelId)
    console.log("[Atividade] Guild ID: ", discordSDK.guildId)

    const container = document.querySelector("#app main")
    const participantsContainer = document.querySelector('#discord-participants')
    montarParticipantesDiscord(participantsContainer, discordSDK)
    montarPlayerWebRTC(container, CLIENT_ID)

  }catch(e){
    console.error("[Atividade] Erro: ", e)
    discordStatus.dataset.state = 'error'
    discordStatus.textContent = "Não foi possivel conectar ao Discord"
  }
}

iniciarActivity()