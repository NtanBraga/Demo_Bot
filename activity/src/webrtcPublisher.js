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

const viewers = new Set();
const peers = new Map();

function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;

    console.log('[WebRTC Publisher]', message);

    logBox.textContent += `${line}\n`;

    if (logBox.textContent.length > 12000) {
        logBox.textContent = logBox.textContent.slice(-9000);
    }

    logBox.scrollTop = logBox.scrollHeight;
}

function updateButtons(){
    connectButton.disabled = socket !== null

    startButton.disabled = !authenticated || captureStream !== null || capturing
    stopButton.disabled = captureStream === null
    audioMode.disabled = captureStream !== null || capturing
}

function send(message){
    if(!authenticated || socket?.readyState !== WebSocket.OPEN) return false

    socket.send(JSON.stringify(message))

    return true
}

function closePeer(viewerId){
    const entry = peers.get(viewerId)

    if(!entry) return

    peers.delete(viewerId)

    entry.pc.onicecandidate = null
    entry.pc.onconnectionstatechange = null
    entry.pc.oniceconnectionstatechange = null

    entry.pc.close()
}

function stopCapture(){
    const stream = captureStream

    captureStream = null

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

async function openPeer(viewerId){
    if(!captureStream || !viewers.has(viewerId) || peers.has(viewerId)) return

    const stream = captureStream

    const pc = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: 'all'
    })

    const entry = {
        pc,
        remoteReady: false,
        draining: false,
        pendingCandidates: [],
        pendingLocalCandidates: [],
        offerSent: false
    }

    peers.set(viewerId, entry)

    pc.onicecandidate = event => {
        const message = {
            type: 'webrtc:ice',
            to: viewerId,
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

        if(pc.connectionState === 'failed'){
            log("Conexão WebRTC falhou." + "Verifique os candidatos ICE e o TURN")
        }
    }

    try{
        for(const track of stream.getTracks()){
            if(track.readyState === 'live'){
                pc.addTrack(track, stream)
            }
        }

        const offer = await pc.createOffer()

        await pc.setLocalDescription(offer)


        if(peers.get(viewerId) !== entry || !viewers.has(viewerId) || captureStream !== stream) return

        if(!send({
            type: 'webrtc:offer',
            to: viewerId,
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
        closePeer(viewerId)
    }
}

async function handleMessage(message){
    switch(message.type){
        case 'publisher:ready':
            authenticated = true

            iceServers = Array.isArray(message.iceServers) ? message.iceServers : []

            statusRTC.textContent = 'Sinalização WebRTC autenticada.'

            log(`Autenticado. Configurações ICE recebidas: ` + `${iceServers.length}.`)

            updateButtons()
            break
        case 'viewer:joined':
            if(typeof message.viewerId !== 'string') return

            viewers.add(message.viewerId)

            log(`Espectador entrou: ` + `${message.viewerId.slice(0, 8)}.`)

            await openPeer(message.viewerId)
            break
        case 'viewer:left':
            if(typeof message.viewerId !== 'string') return

            viewers.delete(message.viewerId)

            closePeer(message.viewerId)

            log(`Espectador saiu` + `${message.viewerId.slice(0, 8)}.`)

            break
        case 'webrtc:answer': {
            const entry = peers.get(message.from)

            if(!entry || entry.pc.signalingState !== 'have-local-offer') return

            try{
                await entry.pc.setRemoteDescription(message.sdp)

                entry.remoteReady = true

                await drainCandidates(entry)

                log(`Resposta SDP recebida de ` + `${message.from.slice(0, 8)}.`)
            }catch(e){
                log(`Erro ao receber SDP: ${e.message}`)
                closePeer(message.from)
            }
            break
        }
        case 'webrtc:ice': {
            const entry = peers.get(message.from)

            if(!entry) return

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

    let token = keyInput.value.trim()

    if(!token){
        statusRTC.textContent = 'Infome a chave de transmissor.'
        return
    }

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
            token
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

        stopCapture()

        statusRTC.textContent = `Sinalização desconectada (${event.code}).`

        log(`WebSocket fechado: ${event.code}.`)

        updateButtons()
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
            frameRate: { ideal: 30},
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

        statusRTC.textContent = 'Capturando. Aguardando espectadores WebRTC...'

        updateButtons()

        await Promise.all([...viewers].map(openPeer))
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
    stopCapture()

    socket?.close(1000, 'Pagina encerrada.')
})
updateButtons()