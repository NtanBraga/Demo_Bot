const statusDecode = document.getElementById("statusDecode")
const streamsElement = document.getElementById("streams")
const canvas = document.getElementById("player")
const ctx = canvas.getContext("2d")

const protocol = location.protocol === "https:" ? "wss:" : "ws:"

const socket = new WebSocket(`${protocol}//${location.host}/ws`)

socket.binaryType = "arraybuffer"

let decoder = null
let streamAtual = null

function limparPlayer(){
    if(decoder && decoder.state !== "closed"){
        decoder.close()
    }

    decoder = null
    streamAtual = null

    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
}

function assistir(id){
    if(socket.readyState !== WebSocket.OPEN) return

    statusDecode.textContent = "Solicitando transmissão..."

    socket.send(JSON.stringify({
        type: "media:watch",
        id
    }))
}
function atualizarLista(streams){
    streamsElement.replaceChildren()

    if(streamAtual && !streams.some(stream => stream.id === streamAtual)){
        limparPlayer()
        statusDecode.textContent = "Transmissão encerrada"
    }
    if(streams.length === 0){
        const li = document.createElement("li")
        li.textContent = "Nenhuma transmissão ativa."
        streamsElement.appendChild(li)
        return
    }
    for(const stream of streams){
        const li = document.createElement("li")
        const button = document.createElement("button")

        button.textContent = `Assistir ${stream.id.slice(0, 8)}`
        button.addEventListener("click", () => {
            assistir(stream.id)
        })

        li.appendChild(button)
        streamsElement.appendChild(li)

    }
}

function configurarDecoder(mensagem){
    if(!window.VideoDecoder){
        statusDecode.textContent = "WebCodecs indisponivel"
        return
    }

    limparPlayer()

    streamAtual = mensagem.streamId

    decoder = new VideoDecoder({
        output(frame) {
            try{
                ctx.drawImage(frame, 0, 0, canvas.width, canvas.height)
                statusDecode.textContent = "Reproduzindo transmissão."
            }finally{
                frame.close()
            }
        },
        error(error){
            console.error("[Demo Live] Decoder: ", error)
            statusDecode.textContent = "Erro na decodificação"
        }
    })

    decoder.configure({
        codec: mensagem.config.codec,
        codedWidth: mensagem.config.codedWidth,
        codedHeight: mensagem.config.codedHeight,
        optimizeForLatency: true
    })

    statusDecode.textContent = "Aguardando keyframe..."
}

function receberFrame(buffer){
    if(!decoder || decoder.state !== "configured") return

    if(buffer.byteLength < 10) return

    const view = new DataView(buffer)
    const type = view.getUint8(0) === 1 ? "key" : "delta"
    const timestamp = view.getFloat64(1)
    const dados = new Uint8Array(buffer, 9)
    const chunk = new EncodedVideoChunk({
        type,
        timestamp,
        data: dados
    })

    try{
        decoder.decode(chunk)
    }catch(e){
        console.error("[Demo Live] Erro ao decodificar: ", e)
    }
}

socket.addEventListener("open", () => {
    console.log("[Demo Live] Espectador conectado.")
    statusDecode.textContent = "Conectado. Escolha uma transmissão"
})
socket.addEventListener("message", event => {
    if(event.data instanceof ArrayBuffer){
        receberFrame(event.data)
        return
    }
    let mensagem
    try{
        mensagem = JSON.parse(event.data)
    }catch{
        return
    }

    switch(mensagem.type){
        case "live:list":
            atualizarLista(mensagem.streams)
            break
        case "media:ready":
            configurarDecoder(mensagem)
            break
        case "media:ended":
            limparPlayer()
            statusDecode.textContent = "Transmissão encerrada"
            break
        case "error":
            console.error("[Servidor]", mensagem.message)
            statusDecode.textContent = mensagem.message
            break
    }
})

socket.addEventListener("close", () => {
    limparPlayer()
    statusDecode.textContent = "Servidor desconectado."
    atualizarLista([])
})
socket.addEventListener("error", error => {
    console.error("[Demo Live] WebSocket: ", error)
})
window.addEventListener("pagehide", () => {
    if(socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "media:unwatch" }))
    }

    socket.close()
    limparPlayer()
})