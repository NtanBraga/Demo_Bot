let encoder = null
let callbackId = null
let ativo = false
let framesCodificados = 0
let forceKeyframe = false

export function solicitarKeyframe(){
    if(!ativo) return

    forceKeyframe = true

    console.log("[Encoder] Novo keyframe solicitado pelo servidor")
}

export async function iniciarEnvioVideo(preview, socket){
    if(!window.VideoEncoder || !window.VideoFrame || !preview.requestVideoFrameCallback){
        throw new Error("WebCodecs não foi suportado neste navegador")
    }

    const config = {
        codec: "avc1.42E01F",
        width: 1280,
        height: 720,
        bitrate: 1_500_000,
        framerate: 30,
        latencyMode: "realtime",
        avc: { format: "annexb" }
    }

    const support = await VideoEncoder.isConfigSupported(config)

    if(!support.supported) throw new Error("Codificação H.264 não suportada")

    const canvas = document.createElement("canvas")
    canvas.width = config.width
    canvas.height = config.height

    const ctx = canvas.getContext("2d", { alpha: false })

    encoder = new VideoEncoder({
        output(chunk) {
            framesCodificados++

            if(framesCodificados <= 3 || chunk.type === "key"){
                console.log("[Encoder] Frame produzido: ", {
                    numero: framesCodificados,
                    tipo: chunk.type,
                    bytes: chunk.byteLength,
                    bufferWebSocket: socket.bufferedAmount
                })
            }

            if(!ativo || socket.readyState !== WebSocket.OPEN) return

            if(socket.bufferedAmount > 600_000) return

            const packet = new ArrayBuffer(9 + chunk.byteLength)
            const view = new DataView(packet)

            view.setUint8(0, chunk.type === "key" ? 1 : 0)
            view.setFloat64(1, chunk.timestamp)

            chunk.copyTo(new Uint8Array(packet, 9))

            socket.send(packet)
        },

        error(error){
            console.error("[Demo Live] Erro no encoder: ", error)
        }
    })
    encoder.configure(support.config)

    socket.send(JSON.stringify({
        type: "media:config",
        codec: config.codec,
        width: config.width,
        height: config.height
    }))

    ativo = true

    let ultimoFrame = 0
    let quantidadeFrames = 0

    function processarFrame(tempo){
        if(!ativo) return

        callbackId = preview.requestVideoFrameCallback(processarFrame)

        if(tempo - ultimoFrame < 1000 / 30) return

        ultimoFrame = tempo

        if(encoder.state !== "configured" || encoder.encodeQueueSize > 2 || socket.bufferedAmount > 600_000 || !preview.videoWidth){
            return
        }

        const escala = Math.min(canvas.width / preview.videoWidth, canvas.height / preview.videoHeight)

        const largura = Math.round(preview.videoWidth * escala)
        const altura = Math.round(preview.videoHeight * escala)

        const x = (canvas.width - largura) / 2
        const y = (canvas.height - altura) / 2

        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(preview, x, y, largura, altura)

        const frame = new VideoFrame(canvas, {
            timestamp: Math.round(performance.now() * 1000)
        })

        try{

            const keyframe = forceKeyframe || quantidadeFrames % 60 === 0 
            encoder.encode(frame, {
                keyframe
            })

            if(keyframe){
                console.log("[Encoder] Keyframe solicitado ao codificador")
            }

            forceKeyframe = false
            quantidadeFrames++
        }finally {
            frame.close()
        }
    }
    callbackId = preview.requestVideoFrameCallback(processarFrame)

    console.log("[Demo Live] Codificação H.264 iniciada ")
}

export function pararEnvioVideo(preview){
    ativo = false

    if(callbackId !== null){
        preview.cancelVideoFrameCallback(callbackId)
        callbackId = null
    }
    if(encoder && encoder.state !== "closed"){
        encoder.close()
    }
    encoder = null
}