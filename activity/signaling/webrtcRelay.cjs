'use strict';

const http = require('node:http')
const crypto = require('node:crypto')
const { WebSocketServer, WebSocket } = require('ws')
const { tratarTokenDiscord } = require('./discordSOAuth.cjs')
const { tratarIdentidadeDiscord, consumirTicketIdentidade } = require('./discordIdentity.cjs')
const { criarCredencialSFU } = require('./sfuAccess.cjs')

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
const MAX_PUBLISHERS = 5

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

let publishers = new Map()
const viewers = new Map()
const streams = new Map()

function getStreamList(requester = null){
    const canSeeIdentities = requester?.role === 'viewer' && Boolean(requester.discordUser)

    return [...streams.values()].map(stream => {
        const watching = [...viewers.values()].filter(
            viewer => viewer.watchingStreamId === stream.id
        )

        const participants = canSeeIdentities
            ? watching
                .filter(viewer => viewer.discordUser)
                .map(viewer => ({
                    id: viewer.discordUser.id,
                    username: viewer.discordUser.username,
                    global_name: viewer.discordUser.global_name,
                    avatar: viewer.discordUser.avatar
                }))
            : []

        return {
            id: stream.id,
            status: stream.status,
            registeredAt: stream.registeredAt,
            startedAt: stream.startedAt,
            viewerCount: watching.length,
            participants
        }
    })
}

function broadcastStreamList(){
    for(const viewer of viewers.values()){
        send(viewer, {
            type: 'streams:snapshot',
            streams: getStreamList(viewer)
        })
    }
}

function stopWatching(viewer, notify = true){
    const previousId = viewer.watchingStreamId

    viewer.watchingStreamId = null
    viewer.negotiationId = null

    if(previousId){
        const previousStream = streams.get(previousId)

        send(previousStream?.publisher, {
            type: 'viewer:left',
            viewerId: viewer.viewerId
        })

    }

    for(const otherViewer of viewers.values()){
        if(otherViewer === viewer || otherViewer.watchingStreamId !== previousId){
            continue
        }

        send(otherViewer, {
            type: 'viewer:departed',
            streamId: previousId,
            viewerId: viewer.viewerId
        })
    }

    if(notify){
        send(viewer, {
            type: 'viewer:unwatched'
        })
    }
    if(previousId){
        broadcastStreamList()
    }
}

function watchStream(viewer, streamId){
    const stream = streams.get(streamId)

    if(!stream || stream.publisher.readyState !== WebSocket.OPEN){
        send(viewer, {
            type: 'error',
            message: 'Tranmissão indisponivel.'
        })
        return false
    }
    if(viewer.watchingStreamId === streamId){
        send(viewer, {
            type: 'viewer:watching',
            streamId
        })
        return true
    }

    if(viewer.watchingStreamId){
        stopWatching(viewer)
    }

    viewer.watchingStreamId = streamId
    viewer.negotiationId = null

    send(viewer, {
        type: 'viewer:watching',
        streamId
    })
    send(stream.publisher, {
        type: 'viewer:joined',
        viewerId: viewer.viewerId,
        codecMode: viewer.codecMode,
        codec: viewer.codec
    })

    broadcastStreamList()

    console.log(
        `[WebRTC] Viewer ${viewer.viewerId.slice(0, 8)} ` +
        `associado à transmissão ${streamId.slice(0, 8)}`
    )
    return true
}

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

function validNegotiationId(id){
    return typeof id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
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
    if(req.url === '/api/token'){
        void tratarTokenDiscord(req, res)
        return
    }
    if(req.url === '/api/identity'){
        void tratarIdentidadeDiscord(req, res)
        return
    }
    if(req.method === 'GET' && req.url === '/health'){
        res.writeHead(200, {
            'content-type': 'application/json',
            'cache-control': 'no-store'
        })
        res.end(JSON.stringify({
            ok: true,
            publisherOnline: publishers.size > 0,
            publishers: publishers.size,
            viewers: viewers.size,
            registeredStreams: streams.size,
            liveStreams: [...streams.values()].filter(stream => stream.status === 'live').length
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
    ws.streamId = null
    ws.watchingStreamId = null
    ws.negotiationId = null
    ws.discordUser = null

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
                if(publishers.size >= MAX_PUBLISHERS){
                    return reject(ws, 'Limite de transmissores atingido.')
                }

                ws.role = 'publisher'

                const streamId = crypto.randomUUID()

                ws.streamId = streamId

                publishers.set(streamId, ws)

                streams.set(streamId, {
                    id: streamId,
                    publisher: ws,
                    status: 'idle',
                    registeredAt: new Date().toISOString(),
                    startedAt: null
                })

                console.log(`[WebRTC] Transmissão registrada: ${streamId}`)

                clearTimeout(authTimeout)

                send(ws, {
                    type: 'publisher:ready',
                    streamId,
                    iceServers: iceServers()
                })

                if(publishers.size === 1){
                    for(const viewer of viewers.values()){
                        if(!viewer.watchingStreamId && viewer.autoWatch){
                            watchStream(viewer, streamId)
                        }
                    }
                }
                

                broadcastStreamList()

                return
            }

            if(msg.type === 'viewer:join' && equalToken(msg.token, VIEW_TOKEN)){

                let verifiedDiscordUser = null

                if(msg.identityTicket !== undefined){
                    if(
                        typeof msg.identityTicket !== 'string' ||
                        msg.identityTicket.length === 0 ||
                        msg.identityTicket.length > 128  
                    ){
                        return reject(ws, 'Ticker de identidade invalido.')
                    }

                    verifiedDiscordUser = consumirTicketIdentidade(msg.identityTicket)

                    if(!verifiedDiscordUser){
                        return reject(ws, 'Ticket de identidade expirado ou utilizado.')
                    }
                }
                ws.discordUser = verifiedDiscordUser


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
                ws.watchingStreamId = null
                ws.autoWatch = msg.autoWatch !== false

                viewers.set(ws.viewerId, ws)
                clearTimeout(authTimeout)

                send(ws, {
                    type: 'viewer:ready',
                    viewerId: ws.viewerId,
                    iceServers: iceServers(),
                    discordIdentity: ws.discordUser
                        ? {
                            id: ws.discordUser.id,
                            username: ws.discordUser.username,
                            global_name: ws.discordUser.global_name
                        }
                        : null
                })

                send(ws, {
                    type: 'streams:snapshot',
                    streams: getStreamList(ws)
                })

                if(publishers.size === 1 && ws.autoWatch){
                    const streamId = publishers.keys().next().value

                    watchStream(ws, streamId)
                }
                return
            }
            return reject(ws, 'Autenticação invalida.')
        }

        if(msg.type === 'streams:list'){
            send(ws, {
                type: 'streams:snapshot',
                streams: getStreamList(ws)
            })
            return
        }

        if(ws.role === 'publisher'){

            if(msg.type === 'publisher:started'){
                const stream = streams.get(ws.streamId)

                if(!stream || stream.publisher !== ws){
                    return reject(ws, 'Transmissão não registrada.')
                }

                if(stream.status !== 'live'){
                    stream.status = 'live'
                    stream.startedAt = new Date().toISOString()

                    console.log(`[WebRTC] Transmissão iniciada: ${stream.id}`)
                    broadcastStreamList()
                }
                return
            }

            if(msg.type === 'publisher:stop'){
                const stream = streams.get(ws.streamId)

                if(stream && stream.publisher === ws){
                    stream.status = 'idle'
                    stream.startedAt = null
                    broadcastStreamList()
                }
                console.log('[WebRTC] Transmissor encerrou a captura.')

                for(const viewer of viewers.values()){
                    if(viewer.watchingStreamId !== ws.streamId){
                        continue
                    }

                    viewer.negotiationId = null

                    send(viewer, {
                        type: 'stream:ended',
                        streamId: ws.streamId
                    })
                }
                return
            }

            const target = typeof msg.to === 'string' ? viewers.get(msg.to) : null

            const validTarget = target?.watchingStreamId === ws.streamId

            if(msg.type === 'webrtc:offer'){
                if(!validSdp(msg.sdp, 'offer') || !validNegotiationId(msg.negotiationId)){
                    return reject(ws)
                }

                if(!validTarget) return

                target.negotiationId = msg.negotiationId

                send(target, {
                    type: 'webrtc:offer',
                    streamId: ws.streamId,
                    negotiationId: msg.negotiationId,
                    sdp: msg.sdp
                })
                return
            }
            if(msg.type === 'webrtc:ice'){

                if(!validCandidate(msg.candidate) || !validNegotiationId(msg.negotiationId)){
                    return reject(ws)
                }

                if(!validTarget || target.negotiationId !== msg.negotiationId) return

                send(target, {
                    type: 'webrtc:ice',
                    streamId: ws.streamId,
                    negotiationId: msg.negotiationId,
                    candidate: msg.candidate
                })
                return
            }
            return reject(ws)
        }
        if(ws.role === 'viewer'){

            if (msg.type === 'viewer:sfu-grant') {
                const roomId = ws.watchingStreamId
                const stream = streams.get(roomId)

                if (
                    !ws.discordUser?.id ||
                    typeof msg.streamId !== 'string' ||
                    msg.streamId !== roomId ||
                    !stream ||
                    stream.publisher?.readyState !== WebSocket.OPEN
                ) {
                    send(ws, {
                        type: 'viewer:sfu-grant',
                        ok: false,
                        error: 'Acesso SFU negado'
                    })
                    return
                }

                try {
                    const token = criarCredencialSFU({
                        roomId,
                        role: 'viewer',
                        userId: ws.discordUser.id
                    })

                    send(ws, {
                        type: 'viewer:sfu-grant',
                        ok: true,
                        streamId: roomId,
                        token,
                        expiresIn: 30
                    })

                } catch (error) {
                    console.error(
                        '[SFU] Falha ao assinar credencial:',
                        error.message
                    )

                    send(ws, {
                        type: 'viewer:sfu-grant',
                        ok: false,
                        error: 'Credencial indisponivel'
                    })
                }

                return
            }

            if(msg.type === 'viewer:watch'){
                if(typeof msg.streamId !== 'string' || msg.streamId.length > 64){
                    return reject(ws, 'Identificador de transmissão invalido.')
                }

                watchStream(ws, msg.streamId)

                return
            }

            if(msg.type === 'viewer:leave'){
                stopWatching(ws)
                return
            }

            const selectedPublisher = streams.get(ws.watchingStreamId)?.publisher

            if(msg.type === 'webrtc:codec-request'){
                const preference = readCodecPreference(msg)

                if(!preference){
                    return reject(ws, 'Preferencia de codec invalida.')
                }

                ws.codecMode = preference.codecMode
                ws.codec = preference.codec

                send(selectedPublisher, {
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

            const currentNegotiation =
                selectedPublisher &&
                msg.streamId === ws.watchingStreamId &&
                validNegotiationId(msg.negotiationId) &&
                ws.negotiationId === msg.negotiationId

            if(msg.type === 'webrtc:answer'){

                if(!validSdp(msg.sdp, 'answer')){
                    return reject(ws)
                }

                if(!currentNegotiation) return

                send(selectedPublisher, {
                    type: 'webrtc:answer',
                    from: ws.viewerId,
                    negotiationId: msg.negotiationId,
                    sdp: msg.sdp
                })
                return
            }
            if(msg.type === 'webrtc:ice'){

                if(!validCandidate(msg.candidate)){
                    return reject(ws)
                }

                if(!currentNegotiation) return

                send(selectedPublisher, {
                    type: 'webrtc:ice',
                    from: ws.viewerId,
                    negotiationId: msg.negotiationId,
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
            stopWatching(ws, false)
            if(viewers.get(ws.viewerId) === ws){
                viewers.delete(ws.viewerId)
            }
        }else if(ws.role === 'publisher' && publishers.get(ws.streamId) === ws){
            publishers.delete(ws.streamId)
            streams.delete(ws.streamId)

            console.log(`[WebRTC] Transmissão removida: ${ws.streamId}`)

            for(const viewer of viewers.values()){
                if(viewer.watchingStreamId !== ws.streamId) continue

                viewer.watchingStreamId = null
                viewer.negotiationId = null

                send(viewer, {
                    type: 'stream:ended',
                    streamId: ws.streamId
                })

                send(viewer, {
                    type: 'viewer:unwatched'
                })
            }
            broadcastStreamList()
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