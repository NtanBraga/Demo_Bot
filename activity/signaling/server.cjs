const http = require("node:http")
const { randomUUID } = require("node:crypto")
const { WebSocketServer, WebSocket } = require("ws")
const { env } = require("node:process")
const { type } = require("node:os")

const HOST = "127.0.0.1"
const PORT = 3001
const DISCORD_APP_ID = "1094793951946473583"

//autorizado apenas testes locais
const allowedOrigins = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    `https://${DISCORD_APP_ID}.discordsays.com`
])

const server = http.createServer((_req, res) => {
    res.writeHead(404)
    res.end()
})

const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2 * 1024 * 1024,
    perMessageDeflate: false
})

server.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url, "http://localhost").pathname

    console.log("[Demo Live] Tentativa de conexão: ", {
        path,
        origin: request.headers.origin
    })

    if(path !== "/ws" || !allowedOrigins.has(request.headers.origin)){
        socket.write("HTTP/1.1 403 Forbidden\r\n" + "Connection: close \r\n\r\n")
        socket.destroy()
        return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws)
    })
})

//mensagem para cliente json
function enviar(ws, mensagem){
    if(ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(mensagem))
    }
}

function obterTransmissao(id){
    return [...wss.clients].find(client =>
        client.clientId === id &&
        client.live &&
        client.videoConfig
    )
}

//envia mensagem para todos
function atualizarTransmissoes() {
    const streams = [...wss.clients]
        .filter((client) => client.live)
        .map((client) => ({
            id: client.clientId
        }))

    for(const client of wss.clients) {
        enviar(client, {
            type: "live:list",
            streams
        })
    }
    console.log(`[Demo Live] Transmissões ativas: ${streams.length}`)
}

function encerrarTransmissao(ws) {
    if(!ws.live) return

    ws.live = false
    ws.videoConfig = null

    for(const client of wss.clients){
        if(client.watchingId === ws.clientId){
            enviar(client, {type: "media:ended" })
            client.watchingId = null
            client.waitingKeyframe = true
        }
    }
    atualizarTransmissoes()
}

function distribuirFrame(publisher, data) {
    if(!publisher.live || !publisher.videoConfig || data.length < 10) return

    const keyframe = data[0] === 1

    for(const viewer of wss.clients){
        if(viewer.watchingId !== publisher.clientId || viewer.readyState !== WebSocket.OPEN) continue

        if(viewer.bufferedAmount > 1_000_000) {
            viewer.waitingKeyframe = true
            continue
        }

        if(viewer.waitingKeyframe && !keyframe) continue

        if(keyframe){
            viewer.waitingKeyframe = false
        }  

        viewer.send(data, {binary: true})
    }
}

wss.on("connection", (ws) => {
    ws.clientId = randomUUID()
    ws.live = false
    ws.videoConfig = null
    ws.watchingId = null
    ws.waitingKeyframe = true

    console.log(`[Demo Live] Cliente conectado: ${ws.clientId}`)

    enviar(ws, {
        type: "welcome",
        id: ws.clientId
    })

    atualizarTransmissoes()

    ws.on("message", (data, isBinary) => {
        if(isBinary){

            const keyframe = data[0] === 1

            if(keyframe) {
                const espectadores = [...wss.clients].filter(
                    client => client.watchingId === ws.clientId && client.readyState === WebSocket.OPEN
                ).length

                console.log("[Servidor] Keyframe recebido: ", {
                    transmissor: ws.clientId,
                    bytes: data.length,
                    espectadores
                })
            }

            distribuirFrame(ws, data)
            return
        }

        let mensagem

        try{
            mensagem = JSON.parse(data.toString())
        }catch(e){
            enviar(ws, {
                type: "error",
                message: "JSON invalido"
            })
            return
        }

        switch(mensagem.type) {
            case "live:start":
                ws.live = true

                console.log(`[Demo Live] Captura iniciada: ${ws.clientId}`)

                atualizarTransmissoes()
                break
            case "live:stop":
                encerrarTransmissao(ws)
                break
            case "media:config": {
                if(!ws.live) break

                if(mensagem.codec !== "avc1.42E01F" || mensagem.width !== 1280 || mensagem.height !== 720){
                    enviar(ws, {
                        type: "error",
                        message: "Configuração de video inválida."
                    })
                    break
                }
                ws.videoConfig = {
                    codec: mensagem.codec,
                    codedWidth: mensagem.width,
                    codedHeight: mensagem.height
                }
                console.log("[Demo Live] Codec configurado: ", ws.clientId)
                break
            }
            case "media:watch": {
                const publisher = obterTransmissao(mensagem.id)

                if(!publisher){
                    enviar(ws, {
                        type: "error",
                        message: "Transmissão não disponivel"
                    })
                    break
                }

                ws.watchingId = publisher.clientId
                ws.waitingKeyframe = true

                enviar(ws, {
                    type: "media:ready",
                    streamId: publisher.clientId,
                    config: publisher.videoConfig
                })
                enviar(publisher, {
                    type: "media:request-keyframe"
                })

                console.log("[Demo Live] Novo keyframe solicitado: ", publisher.clientId)

                console.log("[Demo Live] Espectador conectado: ", ws.clientId, "->", publisher.clientId)
                break
            }
            case "media:unwatch":
                ws.watchingId = null
                ws.waitingKeyframe = true
                break
            default:
                enviar(ws, {
                    type: "error",
                    message: `Mensagem desconhecida: ${mensagem.type}`
                })
        }
    })
    
    ws.on("close", () => {
        console.log(`[Demo Live] Cliente desconectado: ${ws.clientId}`)

        if(ws.live) encerrarTransmissao(ws)
    })

    ws.on("error", (error) => {
        console.log(`[Demo Live] Erro WebSocket: ${error}`)
    })
})

server.listen(PORT, HOST, () => {
    console.log(`[Demo Live] WebSocket em ws://${HOST}:${PORT}/ws`)
})