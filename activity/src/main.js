import { montarPlayerMSE } from './mseActivityPlayer'
import './style.css'
import { DiscordSDK } from "@discord/embedded-app-sdk"
import { montarPlayerWebRTC } from './webrtcActivityPlayer'

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID

document.querySelector('#app').innerHTML = `
  <main>
    <h1>Demo Live</h1>
    <h2>Compartilhamento de tela</h2>


    <p id="discord-status">Aguardando conexão com Discord...</p>
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

    discordStatus.textContent = "Conectado ao discord com sucesso"
    console.log("[Atividade] SDK conectado.")
    console.log("[Atividade] Channel ID: ", discordSDK.channelId)
    console.log("[Atividade] Guild ID: ", discordSDK.guildId)

    const container = document.querySelector("#app main")

    montarPlayerMSE(container, CLIENT_ID)
    montarPlayerWebRTC(container, CLIENT_ID)

  }catch(e){
    console.error("[Atividade] Erro: ", e)
    discordStatus.textContent = "Não foi possivel conectar ao Discord"
  }
}

iniciarActivity()