import { SfuSession,formatSfuStats } from './sfuSession.js'

const keyInput = document.querySelector('#publisher-key');
const connectButton = document.querySelector('#connect-webrtc');
const startButton = document.querySelector('#start-webrtc');
const stopButton = document.querySelector('#stop-webrtc');
const audioMode = document.querySelector('#audio-mode');
const preview = document.querySelector('#preview-webrtc');
const statusRTC = document.querySelector('#webrtc-status');
const logBox = document.querySelector('#webrtc-logs');

let socket = null;
let authenticated = false;
let captureStream = null;
let capturing = false;
let iceServers = [];

const USE_SFU = true

let sfuSession = null
let sfuReady = false

let cachedPublisherToken = null
let pendingPublisherToken = null

let sfuGrantPending = false
let sfuGrantTimeout = null
let sfuRetryTimer = null
let sfuRetryAttempts = 0

let relayRetryTimer = null
let relayRetryAttempts = 0

let closingPage = false

const viewers = new Set();
const peers = new Map();

const viewerCodecPreferences = new Map()

const VALID_VIDEO_CODECS = ['h264', 'av1', 'vp8']

const sfuCodecWrapper = document.createElement('label')

sfuCodecWrapper.textContent = 'Codec de transmissão SFU: '

const sfuCodecSelect = document.createElement('select')

sfuCodecSelect.id = 'publisher-sfu-codec'

for (const codec of ['h264', 'vp8', 'av1']) {
    const option = document.createElement('option')

    option.value = codec
    option.textContent = codec.toUpperCase()

    sfuCodecSelect.appendChild(option)
}

sfuCodecSelect.value = 'h264'

sfuCodecWrapper.appendChild(sfuCodecSelect)

sfuCodecWrapper.hidden = !USE_SFU

audioMode.parentElement.insertAdjacentElement(
    'afterend',
    sfuCodecWrapper
)

const sfuStatsBox = document.createElement('pre')

sfuStatsBox.id = 'publisher-sfu-stats'
sfuStatsBox.textContent = 'Aguardando conexão SFU.'

sfuStatsBox.hidden = !USE_SFU

logBox.insertAdjacentElement('beforebegin', sfuStatsBox)


function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;

    console.log('[WebRTC Publisher]', message);

    logBox.textContent += `${line}\n`;

    if (logBox.textContent.length > 12000) {
        logBox.textContent = logBox.textContent.slice(-9000);
    }

    logBox.scrollTop = logBox.scrollHeight;
}

function normalizeCodecPreference(codecMode, codec){
    return {
        codecMode: codecMode === 'manual' ? 'manual' : 'auto',
        codec: VALID_VIDEO_CODECS.includes(codec) ? codec : 'h264'
    }
}

function updateButtons(){
    connectButton.disabled = socket !== null

    startButton.disabled = !authenticated || (USE_SFU && !sfuReady) || captureStream !== null || capturing
    stopButton.disabled = captureStream === null
    audioMode.disabled = captureStream !== null || capturing

    sfuCodecSelect.disabled =
        !sfuReady ||
        captureStream !== null ||
        capturing

    if (USE_SFU && sfuReady && sfuSession?.device) {
        const supported = sfuSession.device.sendRtpCapabilities.codecs

        for (const option of sfuCodecSelect.options) {
            option.disabled = !supported.some(codec =>
                codec.mimeType.toLowerCase() ===
                `video/${option.value}`
            )
        }

        if (sfuCodecSelect.selectedOptions[0]?.disabled) {
            const fallback = [...sfuCodecSelect.options].find(
                option => !option.disabled
            )

            if (fallback) {
                sfuCodecSelect.value = fallback.value
            }
        }
    }
}

function send(message){
    if(!authenticated || socket?.readyState !== WebSocket.OPEN) return false

    socket.send(JSON.stringify(message))

    return true
}

function clearSfuGrantPending() {
    sfuGrantPending = false

    if (sfuGrantTimeout !== null) {
        clearTimeout(sfuGrantTimeout)
        sfuGrantTimeout = null
    }
}

function requestPublisherSfuGrant() {
    if (
        !USE_SFU ||
        closingPage ||
        !authenticated ||
        sfuSession ||
        sfuGrantPending
    ) return

    sfuGrantPending = send({
        type: 'publisher:sfu-grant'
    })

    if (!sfuGrantPending) return

    sfuGrantTimeout = setTimeout(() => {
        sfuGrantTimeout = null
        sfuGrantPending = false

        log('SFU: resposta de autorização demorou.')

        schedulePublisherSfuRetry()
    }, 8000)
}

function schedulePublisherSfuRetry() {
    if (
        !USE_SFU ||
        closingPage ||
        !authenticated ||
        sfuSession ||
        sfuRetryTimer
    ) return

    const delay = Math.min(
        1000 * (2 ** Math.min(sfuRetryAttempts++, 4)),
        10000
    )

    log(`SFU: nova tentativa em ${delay / 1000}s.`)

    sfuRetryTimer = setTimeout(() => {
        sfuRetryTimer = null
        requestPublisherSfuGrant()
    }, delay)
}

function schedulePublisherRelayRetry() {
    if (
        closingPage ||
        !cachedPublisherToken ||
        socket ||
        relayRetryTimer
    ) return

    const delay = Math.min(
        1000 * (2 ** Math.min(relayRetryAttempts++, 4)),
        10000
    )

    log(`Relay: reconectando em ${delay / 1000}s.`)

    relayRetryTimer = setTimeout(() => {
        relayRetryTimer = null
        connect()
    }, delay)
}

function closePeer(viewerId){
    const entry = peers.get(viewerId)

    if(!entry) return

    if(entry.monitorTimer !== null){
        clearInterval(entry.monitorTimer)
        entry.monitorTimer = null
    }

    peers.delete(viewerId)

    entry.pc.onicecandidate = null
    entry.pc.onconnectionstatechange = null
    entry.pc.oniceconnectionstatechange = null

    entry.pc.close()
}

function stopCapture(){
    const stream = captureStream

    captureStream = null

    if (USE_SFU && sfuSession) {
        sfuSession.stopStats()
        sfuStatsBox.textContent = 'Transmissão parada.'
        sfuSession.stopPublishing().catch(error => {
            log('Falha ao parar SFU: ' + error.message)
        })
    }

    if(stream && authenticated){
        send({
            type: 'publisher:stop'
        })
        log(`Encerramento comunicado aos espectadores.`)

        send({
            type: 'streams:list'
        })
    }

    for(const viewerId of peers.keys()){
        closePeer(viewerId)
    }

    if(stream){
        for(const track of stream.getTracks()){
            track.stop()
        }
    }

    preview.srcObject = null

    statusRTC.textContent = authenticated ? 'Captura parada. Sinalização conectada.' : 'Desconectado'

    updateButtons()
}

async function drainCandidates(entry){
    if(!entry.remoteReady || entry.draining || entry.pc.signalingState === 'closed'){
        return
    }

    entry.draining = true

    try{
        while(entry.pendingCandidates.length && entry.pc.signalingState !== 'closed'){
            const candidate = entry.pendingCandidates.shift()

            try{
                await entry.pc.addIceCandidate(candidate)
            }catch(e){
                log(`ICE remoto rejeitado: ${e.message}`)
            }
        }
    }finally{
        entry.draining = false
    }
}

function startSendMonitor(viewerId, entry){
    if(entry.monitorTimer){
        clearInterval(entry.monitorTimer)
    }

    let previous = null
    let codecLogged = false

    entry.monitorTimer = setInterval(async () => {
        if(peers.get(viewerId) !== entry || entry.pc.connectionState !== 'connected') return
        
        try{
            const stats = await entry.pc.getStats()

            if(peers.get(viewerId) !== entry) return

            const reports = [...stats.values()]

            const outbound = reports.find(report => 
                report.type === 'outbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')
            )

            const source = reports.find(report => report.type === 'media-source' && report.kind === 'video')

            if(!outbound || typeof outbound.framesEncoded !== 'number') return

            if (!codecLogged) {
                const codec = stats.get(outbound.codecId)

                log(
                    `Codec de vídeo: ${codec?.mimeType ?? 'n/d'}, ` +
                    `Encoder: ${outbound.encoderImplementation ?? 'n/d'}`
                )

                codecLogged = true
            }

            const current = {
                time: performance.now(),
                framesEncoded: outbound.framesEncoded,
                totalEncodeTime: outbound.totalEncodeTime ?? 0
            }

            if(previous){

                const targetBitrate = outbound.targetBitrate != null
                    ? `${(outbound.targetBitrate / 1_000_000).toFixed(2)} Mbps`
                    : 'n/d'

                const seconds = (current.time - previous.time) / 1000

                const fpsEncoded = (current.framesEncoded - previous.framesEncoded) / seconds

                const encodedFrames = current.framesEncoded - previous.framesEncoded

                const encodeTime =
                    current.totalEncodeTime - previous.totalEncodeTime

                const avgEncodeMs = encodedFrames > 0
                    ? (encodeTime / encodedFrames) * 1000
                    : 0

                log(
                    `ENVIO ${viewerId.slice(0, 8)}: ` +
                    `FPS capturados=${source?.framesPerSecond ?? 'n/d'},` +
                    `FPS codificados=${fpsEncoded.toFixed(1)}, ` +
                    `Limitação=${outbound.qualityLimitationReason ?? 'n/d'}` +
                    `Resolução=${outbound.frameWidth ?? '?'}x${outbound.frameHeight ?? '?'}` +
                    `Tempo médio de codificação=${avgEncodeMs.toFixed(1)}ms, ` +
                    `Bitrate alvo=${targetBitrate}, `
                )
            }
            previous = current
        }catch(e){
            log(`Erro no monitor de envio: ${e.message}`)
        }
    }, 3000)
}

async function openPeer(viewerId){
    if(!captureStream || !viewers.has(viewerId) || peers.has(viewerId)) return

    const stream = captureStream

    const pc = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: 'all'
    })

    const entry = {
        pc,
        negotiationId: crypto.randomUUID(),
        remoteReady: false,
        draining: false,
        pendingCandidates: [],
        pendingLocalCandidates: [],
        offerSent: false,
        monitorTimer: null
    }

    peers.set(viewerId, entry)

    pc.onicecandidate = event => {
        if(peers.get(viewerId) !== entry) return

        const message = {
            type: 'webrtc:ice',
            to: viewerId,
            negotiationId: entry.negotiationId,
            candidate: event.candidate ? event.candidate.toJSON() : null
        }

        if(!entry.offerSent){
            entry.pendingLocalCandidates.push(message)
        }else{
            send(message)
        }
    }
    pc.oniceconnectionstatechange = () => {
        log(`ICE ${viewerId.slice(0, 8)}: ${pc.iceConnectionState}`)
    }

    pc.onconnectionstatechange = () => {
        log(`Conexão ${viewerId.slice(0, 8)}:` + pc.connectionState)

        if(pc.connectionState === 'connected'){
            startSendMonitor(viewerId, entry)
        }

        if(pc.connectionState === 'failed'){
            log("Conexão WebRTC falhou." + "Verifique os candidatos ICE e o TURN")
        }
    }

    try{
        let videoSender = null

        for(const track of stream.getTracks()){
            if(track.readyState !== 'live') continue

            const sender = pc.addTrack(track, stream)

            if(track.kind === 'video'){
                videoSender = sender
            }
        }

        if(videoSender){
            const preference = viewerCodecPreferences.get(viewerId) ?? {
                codecMode: 'auto',
                codec: 'h264'
            }

            const transceiver = pc.getTransceivers().find(t => t.sender === videoSender)

            const requestedType = `video/${preference.codec}`

            const codecPriority = [requestedType]

            const sendCodecs = RTCRtpSender.getCapabilities('video')?.codecs ?? []
            const receiveCodecs = RTCRtpReceiver.getCapabilities('video')?.codecs ?? []

            const sendTypes = new Set(sendCodecs.map(codec => codec.mimeType.toLowerCase()))
            const preferredCodecs = codecPriority.flatMap(type => {
                if(!sendTypes.has(type)) return []

                return receiveCodecs.filter(codec => codec.mimeType.toLowerCase() === type)
            })

            const auxiliatyTypes = new Set([
                'video/rtx',
                'video/red',
                'video/ulpfec',
                'video/flexfec-03'
            ])

            const auxiliatyCodecs = receiveCodecs.filter(codec =>
                auxiliatyTypes.has(codec.mimeType.toLowerCase())
            )

            if(preferredCodecs.length > 0 && typeof transceiver?.setCodecPreferences === 'function'){
                try{
                    transceiver.setCodecPreferences([
                        ...preferredCodecs,
                        ...auxiliatyCodecs
                    ])
                    log('Prioridade de codecs: ' + [...new Set(preferredCodecs.map(c => c.mimeType))].join(' -> '))
                }catch(e){
                    log(`Erro ao configurar codecs: ${e.message}`)
                }
            }else{
                log('Usando a negociação padrão de codecs WebRTC.')
            }
        }

        if (videoSender) {
            const params = videoSender.getParameters()

            if (params.encodings?.length) {
                try {
                    params.encodings[0].maxBitrate = 8_000_000

                    await videoSender.setParameters(params)

                    log(
                        `Bitrate máximo permitido: ` +
                        `${videoSender.getParameters().encodings[0].maxBitrate / 1_000_000} Mbps`
                    )
                } catch (error) {
                    log(`Erro ao configurar bitrate: ${error.message}`)
                }
            } else {
                log('O navegador não disponibilizou parâmetros de encoding.')
            }
        }


        const offer = await pc.createOffer()

        await pc.setLocalDescription(offer)


        if(peers.get(viewerId) !== entry || !viewers.has(viewerId) || captureStream !== stream) return

        if(!send({
            type: 'webrtc:offer',
            to: viewerId,
            negotiationId: entry.negotiationId,
            sdp: pc.localDescription.toJSON()
        })){
            closePeer(viewerId)
            return
        }

        entry.offerSent = true

        for(const candidate of entry.pendingLocalCandidates){
            send(candidate)
        }

        entry.pendingLocalCandidates.length = 0

        log(`Oferta enviada para ${viewerId.slice(0,8)}.`)
    }catch(e){
        log(`Erro ao negociar com ${viewerId.slice(0,8)}: ` + e.message)
        if(peers.get(viewerId) === entry){
            closePeer(viewerId)
        }
    }
}

async function handleMessage(message){
    switch(message.type){
        case 'publisher:ready':
            authenticated = true
            cachedPublisherToken = pendingPublisherToken
            pendingPublisherToken = null

            relayRetryAttempts = 0
            sfuRetryAttempts = 0

            clearTimeout(relayRetryTimer)
            relayRetryTimer = null

            if (USE_SFU) {
                requestPublisherSfuGrant()
            }

            iceServers = Array.isArray(message.iceServers) ? message.iceServers : []

            statusRTC.textContent = 'Sinalização WebRTC autenticada.'

            log(`Autenticado. Configurações ICE recebidas: ` + `${iceServers.length}.`)

            updateButtons()

            log(`ID da transmissão: ${message.streamId ?? 'n/d'}`)

            send({
                type: 'streams:list'
            })

            break
        case 'publisher:sfu-grant': {
            if (!USE_SFU) break

            clearSfuGrantPending()

            if (sfuSession) break

            if (!message.ok) {
                log('Autorizacao SFU: ' + message.error)
                schedulePublisherSfuRetry()
                break
            }
            

            const roomId = message.streamId

            const url = new URL('/ws-sfu', location.href)

            url.protocol = location.protocol === 'https:'
                ? 'wss:'
                : 'ws:'

            url.searchParams.set('role', 'publisher')
            url.searchParams.set('room', roomId)

            sfuSession?.close()
            sfuReady = false

            const session = new SfuSession({
                role: 'publisher',
                roomId,
                url: url.toString(),

                onClose: ({ reason } = {}) => {
                    if (sfuSession !== session) return

                    sfuSession = null
                    sfuReady = false

                    log(
                        'SFU desconectado: ' +
                        (reason || 'Conexão interrompida')
                    )

                    if (captureStream && authenticated) {
                        send({
                            type: 'publisher:stop'
                        })
                    }

                    updateButtons()
                    schedulePublisherSfuRetry()
                }
            })

            sfuSession = session

            try {
                await session.connect(message.token)

                if (sfuSession !== session) {
                    session.close()
                    break
                }

                sfuReady = true
                sfuRetryAttempts = 0

                clearTimeout(sfuRetryTimer)
                sfuRetryTimer = null

                log('Publisher conectado ao mediasoup na Azure.')

                const streamToRestore = captureStream

                if (
                    streamToRestore &&
                    streamToRestore.getVideoTracks().some(
                        track => track.readyState === 'live'
                    )
                ) {
                    log('SFU: restaurando a transmissão existente.')

                    await session.publish(
                        streamToRestore,
                        sfuCodecSelect.value
                    )

                    if (
                        sfuSession !== session ||
                        captureStream !== streamToRestore
                    ) {
                        await session.stopPublishing().catch(() => {})
                        break
                    }

                    send({
                        type: 'publisher:started'
                    })

                    log('SFU: vídeo e áudio republicados.')
                }

                session.startStats(stats => {
                    if (sfuSession === session) {
                        sfuStatsBox.textContent = formatSfuStats(stats)
                    }
                })
                statusRTC.textContent = 'SFU conectado. Pronto para compartilhar.'

                updateButtons()

            } catch (error) {
                if (sfuSession === session) {
                    sfuSession = null
                    sfuReady = false
                }

                session.close()

                log('Falha ao conectar SFU: ' + error.message)
                schedulePublisherSfuRetry()

                updateButtons()
            }

            break
        }
        case 'streams:snapshot': {
            const streams = Array.isArray(message.streams)
                ? message.streams
                : []

            log(`Catálogo: ${streams.length} transmissão(ões) registrada(s).`)

            for(const stream of streams){
                log(
                    `Transmissão ${stream.id?.slice(0, 8)}: ` + 
                    `${stream.status}` +
                    (stream.startedAt ? ` (iniciada em ${stream.startedAt})` : '')
                )
            }
            break
        }
        case 'webrtc:codec-request': {
            const viewerId = message.from

            if(!viewerId || !viewers.has(viewerId)) break

            const nextPreference = normalizeCodecPreference(message.codecMode, message.codec)
            const previous = viewerCodecPreferences.get(viewerId)

            if(previous?.codecMode === nextPreference.codecMode &&  previous?.codec === nextPreference.codec) break

            viewerCodecPreferences.set(viewerId, nextPreference)

            log(
                `Alterando codec de ${viewerId.slice(0, 8)} para ` +
                `${nextPreference.codec.toUpperCase()} ` +
                `(${nextPreference.codecMode})`
            )

            closePeer(viewerId)

            await openPeer(viewerId)

            break
        }
        case 'viewer:joined':
            if(typeof message.viewerId !== 'string') return

            viewers.add(message.viewerId)

            viewerCodecPreferences.set(
                message.viewerId,
                normalizeCodecPreference(message.codecMode, message.codec)
            )

            log(`Espectador entrou: ` + `${message.viewerId.slice(0, 8)}.`)

            log(
                `Preferência inicial: ` +
                `${message.codec?.toUpperCase() ?? 'H264'} ` +
                `(${message.codecMode ?? 'auto'})`
            )


            await openPeer(message.viewerId)
            break
        case 'viewer:left':
            if(typeof message.viewerId !== 'string') return

            viewers.delete(message.viewerId)
            viewerCodecPreferences.delete(message.viewerId)

            closePeer(message.viewerId)

            log(`Espectador saiu: ` + `${message.viewerId.slice(0, 8)}.`)

            break
        case 'webrtc:answer': {
            const entry = peers.get(message.from)

            if(!entry ||
                entry.negotiationId !== message.negotiationId ||
                entry.pc.signalingState !== 'have-local-offer') return

            try{
                await entry.pc.setRemoteDescription(message.sdp)

                if(peers.get(message.from) !== entry) break

                entry.remoteReady = true

                await drainCandidates(entry)

                if(peers.get(message.from) === entry){
                    log(`Resposta SDP recebida de ` + `${message.from.slice(0, 8)}.`)
                }
            }catch(e){
                log(`Erro ao receber SDP: ${e.message}`)
                
                if(peers.get(message.from) === entry){
                    closePeer(message.from)
                }
            }
            break
        }
        case 'webrtc:ice': {
            const entry = peers.get(message.from)

            if(!entry || entry.negotiationId !== message.negotiationId) return

            entry.pendingCandidates.push(message.candidate ?? null)

            await drainCandidates(entry)
            break
        }
        case 'error':
            log(`Servidor: ${message.message || 'Erro desconhecido.'}`)
            statusRTC.textContent = 'Erro de sinalização.'
            break
        default:
            log(`Mensagem não reconhecida: ${message.type}.`)
    }
}

function connect(){
    if(socket) return

    let token = keyInput.value.trim() || cachedPublisherToken

    if(!token){
        statusRTC.textContent = 'Infome a chave de transmissor.'
        return
    }
    pendingPublisherToken = token

    const url = new URL('/ws-webrtc', location.href)

    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'

    if(url.protocol === 'ws:' && !['localhost', '127.0.0.1'].includes(url.hostname)){
        statusRTC.textContent = `É necessário HTTPS/WSS fora do localhost`
        return
    }

    const ws = new WebSocket(url)

    socket = ws

    statusRTC.textContent = 'Conectando a sinalização.'

    updateButtons()

    ws.addEventListener('open', () => {
        if(socket !== ws) return

        ws.send(JSON.stringify({
            type: 'publisher:join',
            token,
            mode: USE_SFU ? 'sfu' : 'p2p'
        }))

        token = ''
        keyInput.value = ''
    })
    ws.addEventListener('message', event => {
        if(socket !== ws || typeof event.data !== 'string') return

        let message

        try{
            message = JSON.parse(event.data)
        }catch(e){
            log('Mensagem inválida do servidor.')
            return
        }

        handleMessage(message).catch(error => {
            log(`Erro de Sinalização: ${error.message}`)
        })
    })
    ws.addEventListener('close', event => {
        if(socket !== ws) return

        socket = null
        authenticated = false
        iceServers = []

        viewers.clear()
        viewerCodecPreferences.clear()

        const oldSession = sfuSession

        sfuSession = null
        sfuReady = false

        oldSession?.close()
        clearSfuGrantPending()

        clearTimeout(sfuRetryTimer)
        sfuRetryTimer = null

        if (!USE_SFU || closingPage || !cachedPublisherToken) {
            stopCapture()

            statusRTC.textContent = `Sinalização desconectada (${event.code}).`
        } else {
            statusRTC.textContent = `Relay desconectado (${event.code}). Tentando reconectar...`
        }

        log(`WebSocket fechado: ${event.code}.`)

        updateButtons()
        schedulePublisherRelayRetry()
    })
    ws.addEventListener('error', () => {
        log(`Falha na conexão WebSocket.`)
    })
}

async function startCapture(){
    if(!authenticated || captureStream || capturing) return

    capturing = true
    updateButtons()

    const mode = audioMode.value

    const options = {
        video: {
            frameRate: { ideal: 30, max: 30},
            width: { ideal: 1920 },
            height: { ideal: 1080 }
        },
        audio: mode !== 'none',
        systemAudio: mode === 'system' ? 'include' : 'exclude'
    }

    try{

        if(mode === 'system'){
            options.video.displaySurface = 'monitor'
            options.systemAudio = 'include'
            options.windowAudio = 'system'
        }

        const stream = await navigator.mediaDevices.getDisplayMedia(options)

        if(!authenticated){
            stream.getTracks().forEach(track => track.stop())
            return
        }

        captureStream = stream

        preview.srcObject = stream

        await preview.play().catch(() => {})

        const videoTrack = stream.getVideoTracks()[0]

        if(!videoTrack){
            throw new Error('Nenhuma faixa de video foi capturada.')
        }

        videoTrack.contentHint = ''

        log(`Preferencia de codificação: ${videoTrack.contentHint}`)

        videoTrack.addEventListener('ended', () => {
            if(captureStream === stream){
                log('Compartilhamento encerrado pelo navegador.')
                stopCapture()
            }
        }, { once: true })

        const audioTracks = stream.getAudioTracks()
        const settings = videoTrack.getSettings()

        log(`Captura iniciada: ` + `${settings.width}x${settings.height},` 
            + `áudio: ${audioTracks.length ? 'sim' : 'não'}.`)

        if(mode !== 'none' && audioTracks.length === 0){
            log('O navegador não forneceu audio.' + 'Verifique a opção de compartilhar audio.')
        }

        if (USE_SFU) {
            const session = sfuSession

            if (!sfuReady || !session) {
                throw new Error('SFU ainda nao conectado')
            }

            await session.publish(stream, sfuCodecSelect.value)

            if (
                captureStream !== stream ||
                sfuSession !== session ||
                session.closed ||
                !authenticated
            ) {
                await session.stopPublishing().catch(error => {
                    log('Falha ao limpar publicação cancelada: ' + error.message)
                })

                return
            }

            log('Video e audio publicados no mediasoup.')

            session.startStats(stats => {
                if (sfuSession === session) {
                    sfuStatsBox.textContent = formatSfuStats(stats)
                }
            })
        }

        if (captureStream !== stream || !authenticated) return
        
        statusRTC.textContent = 'Capturando. Aguardando espectadores WebRTC...'

        updateButtons()

        if(!send({
            type: 'publisher:started'
        })) throw new Error('Não foi possivel comunicar o inicio da transmissão')

        log('Estado da transmissão informado: live.')

        send({
            type: 'streams:list'
        })

        if (!USE_SFU) {
            await Promise.all([...viewers].map(openPeer))
        }
    }catch(e){
        log(`Erro na captura: ${e.name || 'Error'} - ` + e.message)
        stopCapture()
    }finally{
        capturing = false
        updateButtons()
    }
}

connectButton.addEventListener('click', connect)
startButton.addEventListener('click', startCapture)
stopButton.addEventListener('click', () => {
    log('Captura encerrada manualmente.')
    stopCapture()
})

window.addEventListener('pagehide', () => {
    closingPage = true

    clearTimeout(sfuRetryTimer)
    clearTimeout(relayRetryTimer)
    clearTimeout(sfuGrantTimeout)

    cachedPublisherToken = null
    stopCapture()
    sfuSession?.close()
    socket?.close(1000, 'Pagina encerrada.')
})
updateButtons()