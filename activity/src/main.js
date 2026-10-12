import './style.css'
import { DiscordSDK } from "@discord/embedded-app-sdk"

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID

document.querySelector('#app').innerHTML = `
  <main>
    <h1>Demo Live</h1>
    <h2>Compartilhamento de tela</h2>
    <p id="discord-status">
      Aguardando conexão com Discord...
    </p>

    <hr>
    <h3>Servidor de transmissão</h3>
    <p id=connection-status>Desconectado</p>

    <hr>
    <h3>Trasmissões disponiveis</h3>
    <ul id="streams"></ul>

  </main>
`

const discordStatus = document.getElementById("discord-status")
const connectionStatus = document.getElementById("connection-status")
const streamElement = document.getElementById("streams")

function atualizarLista(streams){
  streamElement.replaceChildren()

  if(streams.length === 0){
    const item = document.createElement("li")
    item.textContent = "Nenhuma transmissão disponivel"

    streamElement.appendChild(item)
    return
  }

  for(const stream of streams) {
    const item = document.createElement("li")
    item.textContent = `Trasmissão: ${stream.id}`
    streamElement.appendChild(item)
  }
}

function conectarWebSocket(){
  const url = `wss://${CLIENT_ID}.discordsays.com/.proxy/ws`

  console.log("[Demo Live] Conectando WebSocket: ", url)

  const socket = new WebSocket(url)

  socket.addEventListener("open", () => {
    connectionStatus.textContent = "Conectado ao servidor"
    console.log("[Demo Live] WebSocket conectado!")
  })
  socket.addEventListener("message", (event) => {
    let mensagem

    try{
      mensagem = JSON.parse(event.data)
    }catch{
      console.error("[Demo Live] Mensagem JSON invalida")
      return
    }

    switch(mensagem.type){
      case "welcome":
        console.log("[Demo Live] Cliente conectado: ", mensagem.id)
        break
      case "live:list":
        atualizarLista(mensagem.streams)
        break
      case "error":
        console.error("[Demo Live] Erro do servidor: ", mensagem.message)
        break
      default:
        console.log("[Demo Live] Mensagem desconhecida: ", mensagem)
    }
  })
  socket.addEventListener("close", (event) => {
    connectionStatus.textContent = "Servidor desconectado."
    atualizarLista([])
    console.warn("[Demo Live] WebSocket desconectado: ", event.code, event.reason)
  })
  socket.addEventListener("error", (error) => {
    connectionStatus.textContent = "Erro na conexão WebSocket."
    console.error("[Demo Live] Erro WebSocket: ", error)
  })

  window.addEventListener("pagehide", () => {
    socket.close()
  })
}

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

    conectarWebSocket()
  }catch(e){
    console.error("[Atividade] Erro: ", e)
    discordStatus.textContent = "Não foi possivel conectar ao Discord"
  }
}

atualizarLista([])
iniciarActivity()