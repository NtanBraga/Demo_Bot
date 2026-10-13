const { WebSocketServer, WebSocket } = require("ws")
const { timingSafeEqual } = require("node:crypto")
const { transcode } = require("node:buffer")

const wss = new WebSocketServer({
    host: "127.0.0.1",
    port: 3002,
    maxPayload: 4 * 1024 * 1024,
    perMessageDeflate: false
})


const PUBLISH_KEY = process.env.DEMO_MSE_PUBLISH_KEY
const VIEW_KEY = process.env.DEMO_MSE_VIEW_KEY

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

function limparHistorico(){
    historico.length = 0
    historicoBytes = 0
    historicoCompleto = true
}

function avisarEspectadores(type){
    for(const espectador of espectadores){
        enviar(espectador, { type })
    }
}


const MAX_HISTORICO = 8 * 1024 * 1024

const historico = []
let historicoBytes = 0
let historicoCompleto = true

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

            if(historicoCompleto){
                if(historicoBytes + data.length <= MAX_HISTORICO){
                    historico.push(Buffer.from(data))
                    historicoBytes += data.length
                }else{
                    historicoCompleto = false
                    historico.length = 0
                    historicoBytes = 0

                    console.warn("[MSE] Limite do historico atingido." + "Novas entradas tardias serão recusadas")
                }
            }

            for(const espectador of espectadores) {
                if(espectador.readyState !== WebSocket.OPEN) continue
            
                if(espectador.bufferedAmount > 8_000_000){
                    espectador.close(1013, "Receptor lento")
                    continue
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
                if(ws !== transmissor) return

                streamActive = true
                limparHistorico()

                avisarEspectadores("stream:reset")

                console.log("[MSE] Nova transmissão iniciada.")
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

                if(transmissor && !historicoCompleto){
                    enviar(ws, {
                        type: "error",
                        message: "Historico indisponivel" + "Reinicie a transmissão para este teste"
                    })
                    break
                }

                espectadores.add(ws)
                console.log("[MSE] Espectadores: ", espectadores.size)

                enviar(ws, {type: "viewer:ready", cachedChunks: historico.length})

                for(const segmento of historico){
                    if(ws.readyState !== WebSocket.OPEN) break

                    ws.send(segmento, { binary: true })
                }

                console.log("[MSE] Novo Espectador:", {
                    total: espectadores.size,
                    segmentosRecuperados: historico.length,
                    bytes: historicoBytes
                })

                break
        }
    })
    ws.on("close", (code, reason) => {
        
        const eraTransmissor = transmissor === ws
        const eraEspectador = espectadores.delete(ws)
        

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