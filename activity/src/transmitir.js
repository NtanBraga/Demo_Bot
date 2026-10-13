const startButton = document.getElementById("start")
const stopButton = document.getElementById("stop")

const preview = document.getElementById("preview")
const statusHTML = document.getElementById("statusHTML")
const info = document.getElementById("info")

const connection = document.getElementById("connection")
const viewerCount = document.getElementById("viewer-count")

let captureStream = null
let recorder = null

const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
const socket = new WebSocket(`${protocol}//${window.location.host}/ws-mse`)

startButton.disabled = true
stopButton.disabled = true

function enviar(mensagem){
    if(socket.readyState !== WebSocket.OPEN) return false

    socket.send(JSON.stringify(mensagem)) 
    
    return true
}

socket.addEventListener("open", () => {
    console.log("[Demo Live] Websocket conectado.")
    connection.textContent = "Aguardando autenticação..."

    const token = prompt("Chave de transmissão do DemoLive: ")

    if(!token?.trim()){
        connection.textContent = "Autenticação cancelada"
        socket.close(1000, "Autenticação cancelada")
        return
    }

    enviar({
        type: "publisher:join",
        token: token.trim()
    })
})

socket.addEventListener("message", (event) => {
    let mensagem
    try{
        mensagem = JSON.parse(event.data)
        console.log("[Demo Live] Mensagem recebida: ", mensagem.type)
    }catch{
        return
    }

    switch(mensagem.type) {
        case "publisher:ready":
            console.log("[Demo Live] Transmissor autenticado")
            connection.textContent = "Autenticado no relay MSE"
            startButton.disabled = false
            break
        case "viewers:count":
            viewerCount.textContent = `Espectadores conectados: ${mensagem.count}`
            console.log(`[Demo Live] Espectadores: ${mensagem.count}`)
            break
        case "error":
            console.error("[Servidor]", mensagem.message)
            connection.textContent = `Erro: ${mensagem.message}`
            startButton.disabled = true
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
    viewerCount.textContent = "Espectadores conectados: 0"
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
            audio: false
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
        
        const mimeType = "video/webm;codecs=vp8"

        if(!MediaRecorder.isTypeSupported(mimeType))throw new Error("VP8/WebM não é suportado neste navegador.")
        
        recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 1_500_000
        })

        recorder.addEventListener("start", () => {
            enviar({ type: "stream:start" })
        })

        recorder.addEventListener("dataavailable", (event) => {
            if(event.data.size === 0) return
            if(socket.readyState !== WebSocket.OPEN) return
            socket.send(event.data)
        })

        recorder.addEventListener("stop", () => {
            enviar({ type: "stream:stop" })
            finalizarCaptura()
            console.log("Transmissão encerrada.")
        })

        recorder.start(1000)

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

function finalizarCaptura(){
    if(captureStream){
        captureStream.getTracks().forEach(track => track.stop())
        captureStream = null
    }

    recorder = null

    preview.pause()
    preview.srcObject = null

    startButton.disabled = socket.readyState !== WebSocket.OPEN
    stopButton.disabled = true

    statusHTML.textContent = "Nenhuma tela sendo capturada."
    info.textContent = ""
}

function pararCaptura(){
    stopButton.disabled = true

    if(recorder && recorder.state !== "inactive"){
        recorder.stop()

        statusHTML.textContent = "Finalizando transmissão..."
        return
    }
    finalizarCaptura()
}

startButton.addEventListener("click", iniciarCaptura)
stopButton.addEventListener("click", pararCaptura)

window.addEventListener("pagehide", () => {
    pararCaptura()
    socket.close()
})