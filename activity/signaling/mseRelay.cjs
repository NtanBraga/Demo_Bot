const { WebSocketServer, WebSocket } = require("ws")
const { timingSafeEqual } = require("node:crypto")
const { criarInspectorWebM } = require("./webmInspector.cjs")
const { criarHistoricoWebM } = require("./webHistory.cjs")
const { default: cluster } = require("node:cluster")

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


let inspectorWebM = null

let transmissor = null
const espectadores = new Set()

let streamActive = false

function avisarEspectadores(type){
    for(const espectador of espectadores){
        enviar(espectador, { type })
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

            inspectorWebM?.analisar(data)

            historico.adicionar(data)

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

                inspectorWebM = criarInspectorWebM()

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
                    cachedBytes: replay.bytes
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