const { WebSocketServer, WebSocket } = require("ws")
const { timingSafeEqual } = require("node:crypto")
const { criarHistoricoWebM } = require("./webHistory.cjs")

const wss = new WebSocketServer({
    host: "127.0.0.1",
    port: 3002,
    maxPayload: 4 * 1024 * 1024,
    perMessageDeflate: false
})

let historico = criarHistoricoWebM()

function limparHistorico(){
    historico = criarHistoricoWebM()
}

const PUBLISH_KEY = process.env.DEMO_MSE_PUBLISH_KEY
const VIEW_KEY = process.env.DEMO_MSE_VIEW_KEY

const CODEC_AV1 = 'video/webm;codecs="av01.0.08M.08"'
const CODEC_VP8 = 'video/webm;codecs="vp8"'

const CODEC_AV1_OPUS = 'video/webm;codecs="av01.0.08M.08,opus"'
const CODEC_VP8_OPUS = 'video/webm;codecs="vp8,opus"'

const CODECS_PERMITIDOS = new Set([
    CODEC_AV1,
    CODEC_VP8,
    CODEC_AV1_OPUS,
    CODEC_VP8_OPUS
])

let codecAtual = null
let fallbackSolicitado = false

if(!PUBLISH_KEY || !VIEW_KEY || PUBLISH_KEY === VIEW_KEY){
    throw new Error("Configure duas chaves direrentes para o relay MSE.")
}

function validarChave(recebida, esperada){
    if(typeof recebida !== "string") return false

    const a = Buffer.from(recebida)
    const b = Buffer.from(esperada)

    return a.length === b.length && timingSafeEqual(a, b)
}
function negarAcesso(ws){
    ws.close(1008, "Acesso não autorizado.")
}


let transmissor = null
const espectadores = new Set()

let streamActive = false

function avisarEspectadores(type, dados = {}){
    for(const espectador of espectadores){
        enviar(espectador, { type, ...dados })
    }
}

function atualizarContagemEspectadores(){
    const total = [...espectadores].filter(ws => ws.readyState === WebSocket.OPEN).length

    console.log("[MSE] Espectadores conectados: ", total)

    const mensagem = {
        type: "viewers:count",
        count: total
    }

    if(transmissor){
        enviar(transmissor, mensagem)
    }

    for(const espectador of espectadores){
        enviar(espectador, mensagem)
    }
}

function enviar(ws, mensagem){
    if(ws.readyState === WebSocket.OPEN){
        ws.send(JSON.stringify(mensagem))
    }
}

wss.on("connection", ws => {
    console.log("[MSE] Nova conexão")

    ws.on("message", (data, isBinary) => {
        if(isBinary){
            if(ws !== transmissor || !streamActive) return

            historico.adicionar(data)

            for(const espectador of espectadores) {
                if(espectador.readyState !== WebSocket.OPEN) continue
            
                if(espectador.bufferedAmount > 8_000_000){
                    espectador.close(1013, "Receptor lento")
                    continue
                }

                const agora = Date.now()
                const fila = espectador.bufferedAmount

                if(fila > 2 * 1024 * 1024) {
                    if(!espectador.redeLentaDesde){
                        espectador.redeLentaDesde = agora
                    }

                    const duracao = agora - espectador.redeLentaDesde
                    const desdeUltimoAviso = agora - (espectador.ultimoAvisoRede || 0)

                    if(duracao >= 5000 && desdeUltimoAviso >= 10000){
                        enviar(espectador, {
                            type: "viewer:network-warning",
                            bufferedBytes: fila
                        })
                        espectador.ultimoAvisoRede = agora
                    }
                }else{
                    espectador.redeLentaDesde = 0
                }


                espectador.send(data, {binary: true})
            }
            return
        }
        let mensagem

        try{
            mensagem = JSON.parse(data.toString())
        }catch{
            return
        }

        switch(mensagem.type) {
            case "publisher:join":
                if(!validarChave(mensagem.token, PUBLISH_KEY)){
                    negarAcesso(ws)
                    break
                }

                if(transmissor && transmissor.readyState === WebSocket.OPEN){
                    enviar(ws, {
                        type: "error",
                        message: "Já existe um transmissor"
                    })
                    break
                }
                transmissor = ws
                streamActive = false
                limparHistorico()

                console.log("[MSE] Transmissor conectado")
                enviar(ws, {type: "publisher:ready"})
                break
            case "stream:start":
                if(ws !== transmissor) break

                if(!CODECS_PERMITIDOS.has(mensagem.mimeType)){
                    enviar(ws, {
                        type: "error",
                        message: "Codec não suportado pelo relay."
                    })
                    break
                }

                codecAtual = mensagem.mimeType
                fallbackSolicitado = false

                streamActive = true
                limparHistorico()

                avisarEspectadores("stream:reset", {
                    mimeType: codecAtual
                })

                console.log("[MSE] Nova transmissão iniciada: ", codecAtual)
                break
            case "stream:stop":
                if(ws !== transmissor) return

                streamActive = false
                limparHistorico()

                avisarEspectadores("stream:ended")
                console.log("[MSE] Transmissão encerrada.")
                break
            case "viewer:join":
                if(!validarChave(mensagem.token, VIEW_KEY)){
                    negarAcesso(ws)
                    break
                }

                const replay = streamActive ? historico.obterReplay() : { partes: [], bytes: 0, clusters: 0}
                
                if(!replay){
                    enviar(ws, {
                        type: "error",
                        message: "Aguardando um Cluster com keyframe." +
                        "Tente conectar novamente."
                    })
                    break
                }
                espectadores.add(ws)

                enviar(ws, {
                    type: "viewer:ready",
                    cachedChunks: replay.partes.length,
                    cachedBytes: replay.bytes,
                    mimeType: streamActive ? codecAtual : null
                })

                for(const parte of replay.partes){
                    if(ws.readyState !== WebSocket.OPEN){
                        break
                    }
                    ws.send(parte, { binary: true })
                }

                console.log("[MSE] Novo Espectador:", {
                    total: espectadores.size,
                    clustersRecuperados: replay.clusters,
                    segmentosRecuperados: replay.partes.length,
                    bytesEnviados: replay.bytes,
                    bytesGuardados: historico.bytesGuardados
                })

                atualizarContagemEspectadores()

                break
            case "viewer:codec-unsupported":
            case "viewer:performance-issue":
                if(!espectadores.has(ws)) break
                if(!streamActive) break
                if(mensagem.mimeType !== codecAtual) break

                if(mensagem.type === "viewer:performance-issue" &&
                    !["dropped-frames", "decoder-stall"].includes(mensagem.reason)
                ){
                    break
                }

                if(codecAtual?.includes("av01") && !fallbackSolicitado){
                    fallbackSolicitado = true

                    console.log("[MSE] Fallback solicitado: ", {
                        origem: mensagem.type,
                        motivo: mensagem.reason ?? "codec-incompativel",
                        codecAtual
                    })

                    const codecFallback = codecAtual.includes("opus")
                        ? CODEC_VP8_OPUS
                        : CODEC_VP8

                    enviar(transmissor, {
                        type: "publisher:use-fallback",
                        mimeType: codecFallback
                    })
                }else if (codecAtual.includes("vp8")){
                    enviar(ws, {
                        type: "error",
                        message: "Este navegador não suporta VP8/WebM"
                    })
                }
                break
        }
    })
    ws.on("close", (code, reason) => {
        
        const eraTransmissor = transmissor === ws
        const eraEspectador = espectadores.delete(ws)
        
        if(eraEspectador) atualizarContagemEspectadores()

        if(eraTransmissor){
            transmissor = null
            streamActive = false

            limparHistorico()
            avisarEspectadores("stream:ended")
        }

        console.log("[MSE] Cliente desconectado: ", {
            code,
            reason: reason.toString(),
            eraTransmissor,
            eraEspectador,
            espectadoresRestantes: espectadores.size,
            transmissaoAtiva: streamActive
        })
    })
    ws.on("error", error => {
        console.error("[MSE] WebSocket: ", error)
    })
})
console.log("[MSE] Relay em ws://127.0.0.1:3002")