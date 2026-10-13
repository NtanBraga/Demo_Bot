import { montarPlayerMSE } from './mseActivityPlayer'
import './style.css'
import { DiscordSDK } from "@discord/embedded-app-sdk"

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID

document.querySelector('#app').innerHTML = `
  <main>
    <h1>Demo Live</h1>
    <h2>Compartilhamento de tela</h2>


    <p id="discord-status">Aguardando conexão com Discord...</p>
    <p id="connection-status">Servidor desconectado</p>

    <hr>

    <h3>Transmissões disponiveis</h3>
    <ul id="streams"></ul>

    <h3>Player</h3>
    <p id="player-status">Selecione uma transmissão.</p>

    <canvas
      id="player"
      width="1280"
      height="720"
      style="width:100%;max-width:960px;background:black;"
    ></canvas>
  </main>
`

const discordStatus = document.getElementById("discord-status")
const connectionStatus = document.getElementById("connection-status")
const playerStatus = document.getElementById("player-status")
const streamElement = document.getElementById("streams")

const canvas = document.getElementById("player")
const ctx = canvas.getContext("2d")

let socket = null
let decoder = null
let streamAtual = null
let primeiroFrame = false

function limparPlayer(){
  if(decoder && decoder.state !== "closed"){
    decoder.close()
  }

  decoder = null
  streamAtual = null
  primeiroFrame = false

  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

function assistir(id){
  if(socket?.readyState !== WebSocket.OPEN) return

  playerStatus.textContent = "Solicitando transmissão..."

  socket.send(JSON.stringify({
    type: "media:watch",
    id
  }))
}

function atualizarLista(streams){
  streamElement.replaceChildren()

  if(streamAtual && !streams.some(stream => stream.id === streamAtual)){
    limparPlayer()
    playerStatus.textContent = "Transmissão encerrada."
  }

  if(streams.length === 0){
    const item = document.createElement("li")
    item.textContent = "Nenhuma transmissão disponivel"

    streamElement.appendChild(item)
    return
  }

  for(const stream of streams) {
    const li = document.createElement("li")
    const button = document.createElement("button")

    button.textContent = `Assistir ${stream.id.slice(0, 8)}`

    button.addEventListener("click", () => {
      assistir(stream.id)
    })

    li.appendChild(button)
    streamElement.appendChild(li)
  }
}

function configurarDecoder(mensagem){
  if(!window.VideoDecoder){
    playerStatus.textContent = "WebCodecs indisponivel."
    return
  }

  limparPlayer()
  streamAtual = mensagem.streamId

  decoder = new VideoDecoder({
    output(frame) {
      try{
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height)
        if(!primeiroFrame){
          primeiroFrame = true
          playerStatus.textContent = "Reproduzindo video"
        }
      }finally {
        frame.close()
      }
    },
    error(error){
      console.error("[Activity] Decoder: ", error)
      playerStatus.textContent = "Erro na decodificação."
    }
  })

  decoder.configure({
    codec: mensagem.config.codec,
    codedWidth: mensagem.config.codedWidth,
    codedHeight: mensagem.config.codedHeight,
    optimizeForLatency: true
  })

  playerStatus.textContent = "Aguardando keyframe..."
}

function receberFrame(buffer){
  if(!decoder || decoder.state !== "configured") return
  if(buffer.byteLength < 10) return

  const view = new DataView(buffer)

  const chunk = new EncodedVideoChunk({
    type: view.getUint8(0) === 1 ? "key" : "delta",
    timestamp: view.getFloat64(1),
    data: new Uint8Array(buffer, 9)
  })

  try{
    decoder.decode(chunk)
  }catch(e){
    console.error("[Activity] Falha ao decodificar: ", e)
  }
}

function conectarWebSocket(){
  const url = `wss://${CLIENT_ID}.discordsays.com/.proxy/ws`

  console.log("[Demo Live] Conectando WebSocket: ", url)

  socket = new WebSocket(url)
  socket.binaryType = "arraybuffer"

  socket.addEventListener("open", () => {
    connectionStatus.textContent = "Conectado ao servidor"
    console.log("[Demo Live] WebSocket conectado!")
  })
  socket.addEventListener("message", (event) => {

    if(event.data instanceof ArrayBuffer){
      receberFrame(event.data)
      return
    }

    let mensagem

    try{
      mensagem = JSON.parse(event.data)
    }catch{
      console.error("[Demo Live] Mensagem JSON invalida")
      return
    }

    switch(mensagem.type){
      case "media:ready":
        configurarDecoder(mensagem)
        break
      case "media:ended":
        limparPlayer()
        playerStatus.textContent = "Transmissão encerrada."
        break
      case "live:list":
        atualizarLista(mensagem.streams)
        break
      case "error":
        console.error("[Demo Live] Erro do servidor: ", mensagem.message)
        playerStatus.textContent = mensagem.message
        break
      default:
        console.log("[Demo Live] Mensagem desconhecida: ", mensagem)
    }
  })
  socket.addEventListener("close", (event) => {
    connectionStatus.textContent = "Servidor desconectado."
    limparPlayer()
    atualizarLista([])
    console.warn("[Demo Live] WebSocket desconectado: ", event.code, event.reason)
  })
  socket.addEventListener("error", (error) => {
    connectionStatus.textContent = "Erro na conexão WebSocket."
    console.error("[Demo Live] Erro WebSocket: ", error)
  })

  window.addEventListener("pagehide", () => {
    socket.close()
    limparPlayer()
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

    montarPlayerMSE(document.querySelector("#app main"), CLIENT_ID)

  }catch(e){
    console.error("[Atividade] Erro: ", e)
    discordStatus.textContent = "Não foi possivel conectar ao Discord"
  }
}

atualizarLista([])
iniciarActivity()