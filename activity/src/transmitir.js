const startButton = document.getElementById("start")
const stopButton = document.getElementById("stop")

const preview = document.getElementById("preview")
const statusHTML = document.getElementById("statusHTML")
const info = document.getElementById("info")

const connection = document.getElementById("connection")
const viewerCount = document.getElementById("viewer-count")

const streamMetrics = document.getElementById("stream-metrics")

let captureStream = null
let recorder = null

let bytesNaJanela = 0
let ultimoSegmentoEm = 0
let ultimaMedicaoEm = performance.now()

let amostrasFilaCritica = 0
let desconexaoPorCongestionamento = false


const CODEC_AV1 = 'video/webm;codecs="av01.0.08M.08"'
const CODEC_VP8 = 'video/webm;codecs="vp8"'
const CODEC_AV1_OPUS = 'video/webm;codecs="av01.0.08M.08,opus"'
const CODEC_VP8_OPUS = 'video/webm;codecs="vp8,opus"'

let preferirVP8 = false
let trocaCodecPendente = null

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
        case "publisher:use-fallback":
            console.warn("[Demo Live] Fallback solicitado pelo relay.")
            solicitarFallbackVP8()
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

    connection.textContent = desconexaoPorCongestionamento ? "Envio interrompido: congestionamento persistente." : "Servidor desconectado"
    startButton.disabled = true
    viewerCount.textContent = "Espectadores conectados: 0"
})

socket.addEventListener("error", (error) => {
    console.error("[Demo Live] Erro de conexão: ", error)
})

function solicitarFallbackVP8(){
    preferirVP8 = true

    if(!captureStream || !recorder) return
    if(trocaCodecPendente) return
    if(recorder.state === "inactive") return

    const temAudio = captureStream.getAudioTracks().some(track => track.readyState === "live")

    const codecFallback = temAudio ? CODEC_VP8_OPUS : CODEC_VP8

    if(!MediaRecorder.isTypeSupported(codecFallback)){
        console.warn("[Codec] VP8 não suporta esta configuração.")
        pararCaptura()
        return
    }

    trocaCodecPendente = codecFallback

    statusHTML.textContent = "Alterando codec para VP8..."
    stopButton.disabled = true


    recorder.stop()
    
}

function iniciarGravador(mimeType){
    const gravador = new MediaRecorder(captureStream, {
        mimeType,
        videoBitsPerSecond: 1_500_000,
        audioBitsPerSecond: 192_000
    })

    console.log("[Audio] Bitrate configurado: ", gravador.audioBitsPerSecond)

    recorder = gravador

    console.log("[Codec] MediaRecorder: ", gravador.mimeType)

    gravador.addEventListener("start", () => {
        const agora = performance.now()

        bytesNaJanela = 0
        ultimaMedicaoEm = agora
        ultimoSegmentoEm = agora
        enviar({
            type: "stream:start",
            mimeType
        })
    })

    gravador.addEventListener("dataavailable", event => {
        if(event.data.size === 0) return
        if(socket.readyState !== WebSocket.OPEN) return

        socket.send(event.data)

        bytesNaJanela += event.data.size
        ultimoSegmentoEm = performance.now()
    })

    gravador.addEventListener("error", event => {
        console.error("[Codec] Erro do MediaRecorder: ", event.error)

        if(mimeType.includes("av01")){
            solicitarFallbackVP8()
        }else{
            pararCaptura()
        }
    })
    gravador.addEventListener("stop", () => {
        enviar({ type: "stream:stop" })

        const proximoCodec = trocaCodecPendente
        trocaCodecPendente = null

        const capturaAtiva = captureStream?.getVideoTracks().some(track => track.readyState === "live")

        if(proximoCodec && capturaAtiva && socket.readyState === WebSocket.OPEN){
            try{
                iniciarGravador(proximoCodec)

                statusHTML.textContent = "Captura ativa (VP8)"
                stopButton.disabled = false

                return
            }catch(e){
                console.error("[Codec] Falha no fallback: ", e)
            }
        }
        finalizarCaptura()
    })
    gravador.start(1000)

    const nomeCodec = mimeType.includes("av01") ? "AV1" : "VP8"
    const temAudio = mimeType.includes("opus")
    statusHTML.textContent = `Captura ativa (${nomeCodec}${temAudio ? " + Opus" : ""}).`
}

function escolherMimeType(){
    const temAudio = captureStream.getAudioTracks().some(
        track => track.readyState === "live"
    )
    const av1 = temAudio ? CODEC_AV1_OPUS : CODEC_AV1
    const vp8 = temAudio ? CODEC_VP8_OPUS : CODEC_VP8

    const candidatos = preferirVP8 ? [vp8] : [av1,vp8]
    const mimeType = candidatos.find(tipo => MediaRecorder.isTypeSupported(tipo))

    if(!mimeType) throw new Error("Nenhum formato WebM compativel com a captura.")

    return mimeType
}

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

        const audioTrack = stream.getAudioTracks()[0]

        if(audioTrack){
            console.log("[Audio] Configuração original: ", audioTrack.getSettings())

            try{
                await audioTrack.applyConstraints({
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                })
            }catch(error){
                console.warn("[Audio] Não foi possivel alterar o processamento: ", error.message)
            }
        }

        preview.srcObject = stream
        await preview.play()

        const videoTrack= stream.getVideoTracks()[0]
        const settings = videoTrack.getSettings()

        info.textContent =
            `${settings.width}x${settings.height} | ` +
            `Audio: ${stream.getAudioTracks().length > 0 ? "Sim" : "Não"}`
        
        const mimeType = escolherMimeType()

        console.log("[Demo Live] Formato selecionado: ", mimeType)
        console.log("[Demo Live] Faixas de audio: ", stream.getAudioTracks().length)

        iniciarGravador(mimeType)

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
    trocaCodecPendente = null
    stopButton.disabled = true

    if(recorder && recorder.state !== "inactive"){
        recorder.stop()

        statusHTML.textContent = "Finalizando transmissão..."
        return
    }
    finalizarCaptura()
}

function monitorarTransmissor(){
    const agora = performance.now()

    const segundos = (agora - ultimaMedicaoEm) / 1000

    ultimaMedicaoEm = agora

    const kbps = segundos > 0 ? Math.round(bytesNaJanela * 8 / (segundos * 1000)) : 0

    bytesNaJanela = 0

    if(!recorder || recorder.state === "inactive"){
        streamMetrics.textContent = "Transmissão inativa."
        amostrasFilaCritica = 0
        return
    }

    const filaBytes = socket.bufferedAmount
    const filaMiB = filaBytes / (1024 * 1024)
    const tempoSemSegmento = (agora - ultimoSegmentoEm) / 1000
    const estadoRede = filaBytes > 8 * 1024 * 1024
        ? "Critico"
        : filaBytes > 2 * 1024 * 1024
            ? "Atenção"
            : "Normal"
    streamMetrics.textContent = 
        `Dados gerados: ${kbps} kb/s |` +
        `Fila de envio: ${filaMiB.toFixed(2)} MiB |` +
        `Rede: ${estadoRede} |` + 
        `Ultimo segmento há ${tempoSemSegmento.toFixed(1)}s`

    if(tempoSemSegmento > 5 && !document.hidden){
        console.warn("[Desempenho] MediaRecorder demorando para gerar segmentos")
    }

    if(filaBytes > 12 * 1024 * 1024){
        amostrasFilaCritica++
    }else{
        amostrasFilaCritica = 0
    }

    if(amostrasFilaCritica >= 3){
        console.error("[Proteção] Fila WebScoker excessiva por tempo prolongado.")
    
        desconexaoPorCongestionamento = true
        amostrasFilaCritica = 0

        pararCaptura()

        if(socket.readyState === WebSocket.OPEN){
            socket.close(1000, "Envio congestionado")
        }
    }
}

const monitorTransmissorInterval = window.setInterval(monitorarTransmissor, 5000)

startButton.addEventListener("click", iniciarCaptura)
stopButton.addEventListener("click", pararCaptura)

window.addEventListener("pagehide", () => {
    pararCaptura()
    clearInterval(monitorTransmissorInterval)
    socket.close()
})