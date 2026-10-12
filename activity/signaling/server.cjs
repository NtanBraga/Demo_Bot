const http = require("node:http")
const { randomUUID } = require("node:crypto")
const { WebSocketServer, WebSocket } = require("ws")

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
    maxPayload: 2048,
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

wss.on("connection", (ws) => {
    ws.clientId = randomUUID()
    ws.live = false

    console.log(`[Demo Live] Cliente conectado: ${ws.clientId}`)

    enviar(ws, {
        type: "welcome",
        id: ws.clientId
    })

    atualizarTransmissoes()

    ws.on("message", (data, isBinary) => {
        if(isBinary){
            ws.close(1003, "Apenas JSON")
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
                ws.live = false

                console.log(`[Demo Live] Captura encerrada: ${ws.clientId}`)

                atualizarTransmissoes()
                break
            default:
                enviar(ws, {
                    type: "error",
                    message: "Mensagem desconhecida"
                })
        }
    })
    
    ws.on("close", () => {
        console.log(`[Demo Live] Cliente desconectado: ${ws.clientId}`)

        atualizarTransmissoes()
    })

    ws.on("error", (error) => {
        console.log(`[Demo Live] Erro WebSocket: ${error}`)
    })
})

server.listen(PORT, HOST, () => {
    console.log(`[Demo Live] WebSocket em ws://${HOST}:${PORT}`)
})