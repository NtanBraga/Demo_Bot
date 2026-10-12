import { iniciarEnvioVideo, pararEnvioVideo, solicitarKeyframe } from "./videoSender"

const startButton = document.getElementById("start")
const stopButton = document.getElementById("stop")

const preview = document.getElementById("preview")
const statusHTML = document.getElementById("statusHTML")
const info = document.getElementById("info")

const connection = document.getElementById("connection")
const clientIdElement = document.getElementById("client-id")
const streamsElements = document.getElementById("streams")

let captureStream = null

const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
const socket = new WebSocket(`${protocol}//${window.location.host}/ws`)

startButton.disabled = true
stopButton.disabled = true

function enviar(mensagem){
    if(socket.readyState !== WebSocket.OPEN) return false

    socket.send(JSON.stringify(mensagem)) 
    
    return true
}

function atualizarLista(streams){
    streamsElements.replaceChildren()

    if(streams.length === 0){
        const item = document.createElement("li")

        item.textContent = "Nenhuma transmissão ativa."

        streamsElements.appendChild(item)
        return
    }

    for(const stream of streams){
        const item = document.createElement("li")
        item.textContent = `Transmissão: ${stream.id}`
        streamsElements.appendChild(item)
    }
}

socket.addEventListener("open", () => {
    console.log("[Demo Live] Websocket conectado.")
    connection.textContent = "Conectado ao servidor."
    startButton.disabled = false
})

socket.addEventListener("message", (event) => {
    let mensagem
    try{
        mensagem = JSON.parse(event.data)
    }catch{
        return
    }

    switch(mensagem.type) {
        case "welcome": 
            clientIdElement.textContent = `Seu ID temporario: ${mensagem.id}`
            break
        case "live:list":
            atualizarLista(mensagem.streams)
            break
        case "media:request-keyframe":
            console.log("[Demo Live] Servidor solicitor keyframe")
            solicitarKeyframe()
            break
        case "error":
            console.error("[Servidor]", mensagem.message)
            break
    }
})

socket.addEventListener("close", (event) => {
    console.log("[Demo Live] Websocket desconectado: ", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
    })

    pararCaptura()

    connection.textContent = "Servidor desconectado."
    startButton.disabled = true
    atualizarLista([])
})

socket.addEventListener("error", (error) => {
    console.error("[Demo Live] Erro de conexão: ", error)
})

async function iniciarCaptura() {
    if(captureStream || socket.readyState !== WebSocket.OPEN) return

    startButton.disabled = true

    try{
        console.log("[Demo Live] Solicitando captura...")

        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: { ideal: 30 },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: true
        })

        if(socket.readyState !== WebSocket.OPEN){
            stream.getTracks().forEach(track => track.stop())
            throw new Error("Conexão com servidor perdida")
        }

        captureStream = stream

        preview.srcObject = stream
        await preview.play()

        const videoTrack= stream.getVideoTracks()[0]
        const settings = videoTrack.getSettings()

        info.textContent =
            `${settings.width}x${settings.height} | ` +
            `Audio: ${stream.getAudioTracks().length > 0 ? "Sim" : "Não"}`
        
        if(!enviar({ type: "live:start" })){
            throw new Error("Não foi possivel avisar o servidor")
        }

        await iniciarEnvioVideo(preview, socket)

        statusHTML.textContent = "Captura ativa."
        stopButton.disabled = false

        videoTrack.addEventListener("ended", pararCaptura)

        console.log("[Demo Live] Captura iniciada: ", settings)
    }catch(error){
        console.error("[Demo Live] Erro: ", error)
        pararCaptura()
        if(error.name === "NotAllowedError"){
            statusHTML.textContent = "Captura cancelada ou não autorizada."
        }else{
            statusHTML.textContent = `Erro ao capturar: ${error.message}`
        }
    }
}
function pararCaptura(){
    const estavaCapturando = captureStream !== null

    pararEnvioVideo(preview)

    if(captureStream) {
        captureStream.getTracks().forEach(track => track.stop())
        captureStream = null
    }

    preview.pause()
    preview.srcObject = null

    if(estavaCapturando) {
        enviar({ type: "live:stop" })
    }

    startButton.disabled = socket.readyState !== WebSocket.OPEN
    stopButton.disabled = true

    statusHTML.textContent = "Nenhuma tela sendo capturada."
    info.textContent = ""

    console.log("[Demo Live] Captura Encerrada")
}

startButton.addEventListener("click", iniciarCaptura)
stopButton.addEventListener("click", pararCaptura)

window.addEventListener("pagehide", () => {
    pararCaptura()
    socket.close()
})