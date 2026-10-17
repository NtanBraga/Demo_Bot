'use strict';

const http = require('node:http')
const crypto = require('node:crypto')
const { WebSocketServer, WebSocket } = require('ws')

const PORT = Number(process.env.WEBRTC_PORT || 3003)
const PUBLISH_TOKEN = process.env.WEBRTC_PUBLISH_TOKEN
const VIEW_TOKEN = process.env.WEBRTC_VIEW_TOKEN

const ORIGIN = new Set(
    (process.env.WEBRTC_ALLOWED_ORIGINS || 'http://localhost:5173, http://127.0.0.1:5173')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
)

const TURN_URLS = (process.env.WEBRTC_TURN_URLS || '')
    .split(',')
    .map(url => url.trim())
    .filter(Boolean)

const TURN_SECRET = process.env.WEBRTC_TURN_SHARED_SECRET || ''

const MAX_VIEWERS = 10

if(!PUBLISH_TOKEN || !VIEW_TOKEN || PUBLISH_TOKEN.length < 32 || VIEW_TOKEN.length < 32){
    throw new Error("Configure WEBRTC_PUBLISH_TOKEN e WEBRTC_VIEW_TOKEN com pelo menos 32 caracteres")
}

if(PUBLISH_TOKEN === VIEW_TOKEN){
    throw new Error("As chaves de publicação e visualização devem ser diferentes.")
}

if(Boolean(TURN_URLS.length) !== Boolean(TURN_SECRET)){
    throw new Error("Configure WEBRTC_TURN_URLS e WEBRTC_TURN_SHARED_SECRET juntos")
}

if(!Number.isInteger(PORT) || PORT < 1 || PORT > 65535){
    throw new Error("WEB_PORTT invalida")
}

let publisher = null
const viewers = new Map()

function equalToken(value, expected){
    if(typeof value !== 'string' || value.length > 4096) return false

    const a = crypto.createHash('sha256').update(value).digest()
    const b = crypto.createHash('sha256').update(expected).digest()

    return crypto.timingSafeEqual(a, b)
}

function iceServers(){
    const result = [
        {
            urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']
        }
    ]

    if(TURN_URLS.length){
        const expires = Math.floor(Date.now() / 1000) + 3600
        const username = `${expires}:${crypto.randomUUID()}`
        const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64')
    
        result.push({
            urls: TURN_URLS,
            username,
            credential
        })
    }
    return result
}

function send(ws, data){
    if(!ws || ws.readyState !== WebSocket.OPEN)return

    if(ws.bufferedAmount > 512 * 1024){
        ws.terminate()
        return
    }

    ws.send(JSON.stringify(data))
}

function reject(ws, reason = 'Mensagem invalida ou acesso negado.'){
    send(ws, {
        type: 'error',
        message: reason
    })

    ws.close(1008, 'Politica de acesso.')
}

function validSdp(sdp, type){
    return (
        sdp && 
        typeof sdp === 'object' &&
        sdp.type === type &&
        typeof sdp.sdp === 'string' &&
        sdp.sdp.length > 0 &&
        sdp.sdp.length <= 100_000
    )
}

function validCandidate(candidate){
    return candidate === null || (
        candidate &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        typeof candidate.candidate === 'string' && candidate.candidate.length <= 4096 
        &&(candidate.sdpMid == null ||
            (typeof candidate.sdpMid === 'string' && candidate.sdpMid.length <= 128)
        ) 
        &&(candidate.sdpMLineIndex == null ||
            (Number.isInteger(candidate.sdpMLineIndex) &&candidate.sdpMLineIndex >= 0 && candidate.sdpMLineIndex < 32)
        ) 
        &&( candidate.usernameFragment == null ||
            (typeof candidate.usernameFragment === 'string' && candidate.usernameFragment.length <= 256))
    )
}

const VALID_CODECS = new Set(['h264','av1','vp8'])

function readCodecPreference(message){
    const codecMode = message.codecMode ?? 'auto'
    const codec = message.codec ?? 'h264'

    if(!['auto', 'manual'].includes(codecMode)) return null
    if(!VALID_CODECS.has(codec)) return null

    return { codecMode, codec }
}

const server = http.createServer((req, res) => {
    if(req.method === 'GET' && req.url === '/health'){
        res.writeHead(200, {
            'content-type': 'application/json',
            'cache-control': 'no-store'
        })
        res.end(JSON.stringify({
            ok: true,
            publisherOnline: Boolean(publisher),
            viewers: viewers.size
        }))

        return
    }

    res.writeHead(404)
    res.end()
})

const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 128 * 1024,
    perMessageDeflate: false
})

server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url, 'http://localhost').pathname

    if(path !== '/ws-webrtc' || !ORIGIN.has(req.headers.origin)){
        socket.write('HTTP/1.1 403 Forbidden\r\n' + 'Connection: close\r\n\r\n')
        socket.destroy()
        return
    }
    wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws)
    })
})

wss.on('connection', ws => {
    ws.role = null
    ws.viewerId = null
    ws.alive = true

    ws.on('pong', () => {
        ws.alive = true
    })

    let windowStart = Date.now()
    let messagesInWindow = 0

    const authTimeout = setTimeout(() => {
        if(!ws.role){
            reject(ws, 'Tempo de autenticação excedido.')
        }
    }, 5000)

    ws.on('message', (raw, isBinary) => {
        if(isBinary) return reject(ws)

        const now = Date.now()

        if(now - windowStart >= 10_000){
            windowStart = now
            messagesInWindow = 0
        }
        if(++messagesInWindow > 120){
            return reject(ws, 'Limite de mensagens excedido.')
        }

        let msg

        try{
            msg = JSON.parse(raw.toString())
        }catch{
            return reject(ws)
        }

        if(!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string'){
            return reject(ws)
        }

        if(!ws.role){
            if(msg.type === 'publisher:join' && equalToken(msg.token, PUBLISH_TOKEN)){
                if(publisher){
                    return reject(ws, 'Já existe um transmissor conectado.')
                }

                ws.role = 'publisher'
                publisher = ws

                clearTimeout(authTimeout)

                send(ws, {
                    type: 'publisher:ready',
                    iceServers: iceServers()
                })

                return
            }

            if(msg.type === 'viewer:join' && equalToken(msg.token, VIEW_TOKEN)){
                if(!publisher){
                    return reject(ws, 'Nenhum transmissor conectado')
                }

                if(viewers.size >= MAX_VIEWERS){
                    return reject(ws, 'Limite de espectadores atingido')
                }

                const preferences = readCodecPreference(msg)
                if(!preferences) {
                    return reject(ws, 'Preferencia de codec invalida.')
                }

                ws.codecMode = preferences.codecMode
                ws.codec = preferences.codec

                ws.role = 'viewer'
                ws.viewerId = crypto.randomUUID()

                viewers.set(ws.viewerId, ws)
                clearTimeout(authTimeout)

                send(ws, {
                    type: 'viewer:ready',
                    viewerId: ws.viewerId,
                    iceServers: iceServers()
                })

                send(publisher, {
                    type: 'viewer:joined',
                    viewerId: ws.viewerId,
                    codecMode: ws.codecMode,
                    codec: ws.codec
                })
                return
            }
            return reject(ws, 'Autenticação invalida.')
        }
        if(ws.role === 'publisher'){

            if(msg.type === 'publisher:stop'){
                console.log('[WebRTC] Transmissor encerrou a captura.')

                for(const viewer of viewers.values()){
                    send(viewer, {
                        type: 'stream:ended'
                    })
                }
                return
            }

            const target = typeof msg.to === 'string' ? viewers.get(msg.to) : null

            if(msg.type === 'webrtc:offer' && target && validSdp(msg.sdp, 'offer')){
                send(target, {
                    type: 'webrtc:offer',
                    sdp: msg.sdp
                })
                return
            }
            if(msg.type === 'webrtc:ice' && target && validCandidate(msg.candidate)){
                send(target, {
                    type: 'webrtc:ice',
                    candidate: msg.candidate
                })
                return
            }
            return reject(ws)
        }
        if(ws.role === 'viewer' && publisher){

            if(msg.type === 'webrtc:codec-request'){
                const preference = readCodecPreference(msg)

                if(!preference){
                    return reject(ws, 'Preferencia de codec invalida.')
                }

                ws.codecMode = preference.codecMode
                ws.codec = preference.codec

                send(publisher, {
                    type: 'webrtc:codec-request',
                    from: ws.viewerId,
                    codecMode: ws.codecMode,
                    codec: ws.codec
                })

                console.log(
                    `[WebRTC] Espectador ${ws.viewerId.slice(0, 8)} ` +
                    `solicitou ${ws.codec} (${ws.codecMode})`
                )

                return
            }

            if(msg.type === 'webrtc:answer' && validSdp(msg.sdp, 'answer')){
                send(publisher, {
                    type: 'webrtc:answer',
                    from: ws.viewerId,
                    sdp: msg.sdp
                })
                return
            }
            if(msg.type === 'webrtc:ice' && validCandidate(msg.candidate)){
                send(publisher, {
                    type: 'webrtc:ice',
                    from: ws.viewerId,
                    candidate: msg.candidate
                })
                return
            }
        }
        return reject(ws)
    })
    ws.on('close', () => {
        clearTimeout(authTimeout)

        if(ws.role === 'viewer'){
            if(viewers.get(ws.viewerId) === ws){
                viewers.delete(ws.viewerId)
            }
            send(publisher, {
                type: 'viewer:left',
                viewerId: ws.viewerId
            })
        }else if(ws.role === 'publisher' && publisher === ws){
            publisher = null

            for(const viewer of viewers.values()){
                send(viewer, {
                    type: 'stream:ended'
                })

                viewer.close(1012, 'Tranmissão encerrada')
            }
            viewers.clear()
        }
    })
    ws.on('error', () => {})
})

const heartbeat = setInterval(() => {
    for(const ws of wss.clients){
        if(!ws.alive){
            ws.terminate()
            continue
        }

        ws.alive = false
        ws.ping()
    }
}, 30000)

heartbeat.unref()

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[WebRTC] Sinalização disponivel em 127.0.0.1:${PORT}`)
    console.log(`[WebRTC] TURN: ${
        TURN_URLS.length ? 'configurado' : 'não configurado (apenas STUN)'
    }`)
})