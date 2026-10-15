const keyInput = document.querySelector('#viewer-key');
const connectButton = document.querySelector('#viewer-connect');
const disconnectButton = document.querySelector('#viewer-disconnect');
const soundButton = document.querySelector('#viewer-sound');
const video = document.querySelector('#viewer-video');
const statusRTC = document.querySelector('#viewer-status');
const logBox = document.querySelector('#viewer-logs');

let socket = null;
let authenticated = false;
let iceServers = [];

let pc = null;
let remoteStream = null;

let remoteReady = false;
let answerSent = false;
let drainingCandidates = false;

let pendingRemoteCandidates = [];
let pendingLocalCandidates = [];

function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;

    console.log('[WebRTC Viewer]', message);

    logBox.textContent += `${line}\n`;

    if (logBox.textContent.length > 12000) {
        logBox.textContent = logBox.textContent.slice(-9000);
    }

    logBox.scrollTop = logBox.scrollHeight;
}

function updateButtons(){
    connectButton.disabled = socket !== null
    disconnectButton.disabled = socket === null

    const hasAudio = remoteStream?.getAudioTracks().some(track => track.readyState === 'live')

    soundButton.disabled = !hasAudio
    soundButton.textContent = video.muted ? 'Ativar som' : 'Silenciar'
}

function send(message) {
    if(!authenticated || socket?.readyState !== WebSocket.OPEN) return false

    socket.send(JSON.stringify(message))
    return true
}

function closePeer(){
    const oldPc = pc

    pc = null

    if(oldPc){
       oldPc.ontrack = null
       oldPc.onicecandidate = null
       oldPc.oniceconnectionstatechange = null
       oldPc.onconnectionstatechange = null
       oldPc.onicecandidateerror = null
       
       oldPc.close()
    }

    remoteReady = false
    answerSent = false
    drainingCandidates = false

    pendingRemoteCandidates = []
    pendingLocalCandidates = []

    remoteStream = null

    video.pause()
    video.srcObject = null
    video.muted = true

    updateButtons()
}

function disconnect(){
    const oldSocket = socket

    socket = null
    authenticated = false
    iceServers = []

    closePeer()

    if(oldSocket && oldSocket.readyState !== WebSocket.CLOSED){
        oldSocket.close(1000, 'Espectador saiu')
    }

    statusRTC.textContent = 'Desconectado'
    updateButtons()
}

async function drainCandidates(connection){
    if(pc !== connection || !remoteReady || drainingCandidates || connection.signalingState === 'closed') return

    drainingCandidates = true

    try{
        while(pc === connection && pendingRemoteCandidates.length && connection.signalingState !== 'closed'){
            const candidate = pendingRemoteCandidates.shift()

            try{
                await connection.addIceCandidate(candidate)
            }catch(e){
                log(`Candidato ICE rejeitado: ${e.message}`)
            }
        }
    }finally{
        drainingCandidates = false
    }
}

async function diagnoseConnection(connection){
    try{
        const stats = await connection.getStats()

        const pair = [...stats.values()].find(report =>
            report.type === 'candidate-pair' &&
            report.state === 'succeeded' &&
            report.nominated === true
        )

        if(!pair){
            log('ICE conectado; par selecionado não identificado')
            return
        }

        const local = stats.get(pair.localCandidateId)
        const remote = stats.get(pair.remoteCandidateId)

        log(`Rota ICE: local=${local?.candidateType || 'n/d'},` + `remoto-${remote?.candidateType || 'n/d'}`)
    
        if(local?.candidateType === 'relay' || remote?.candidateType === 'relay'){
            log('A tranmissão esta utilizando TURN.')
        }
    }catch(e){
        log(`Diagnostico ICE: ${e.message}`)
    }
}

async function receiveOffer(description){
    if(!authenticated) return
    if(!description || description.type !== 'offer' || typeof description.sdp !== 'string'){
        log('Oferta SDP invalida.')
        return
    }

    closePeer()

    const connection = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: 'all'
    })

    pc = connection

    remoteStream = new MediaStream()
    video.srcObject = remoteStream
    video.muted = true


    connection.ontrack = event => {
        if(pc !== connection) return

        const track = event.track

        const exists = remoteStream.getTracks().some(current => current.id === track.id)

        if(!exists){
            remoteStream.addTrack(track)
        }

        log(`Faixa recebida: ${track.kind}.`)

        track.addEventListener('ended', () => {
            log(`Faixa encerrada: ${track.kind}`)
            updateButtons()
        }, { once: true })

        updateButtons()

        video.play().catch(error => {
            log(`Não foi possivel iniciar o video: ${error.message}`)
        })
    }
    connection.onicecandidate = event => {
        if(pc !== connection) return

        const message = {
            type: 'webrtc:ice',
            candidate: event.candidate ? event.candidate.toJSON() : null
        }

        if(!answerSent){
            pendingLocalCandidates.push(message)
        }else{
            send(message)
        }
    }
    connection.oniceconnectionstatechange = () => {
        if(pc !== connection) return

        const state = connection.iceConnectionState

        log(`ICE: ${state}`)

        if(state === 'failed'){
            statusRTC.textContent = 'Falha ICE.Verifique conectividade e TURN'
        }
        if(state === 'connected' || state === 'completed'){
            diagnoseConnection(connection)
        }
    }
    connection.onconnectionstatechange = () => {
        if(pc !== connection) return

        const state = connection.connectionState

        log(`Conexão WebRTC: ${state}`)

        if(state === 'connected'){
            statusRTC.textContent = 'Transmissão WebRTC conectada.'
        }
        if(state === 'disconnected'){
            statusRTC.textContent = 'Conexão interrompida temporariamente.'
        }
        if(state === 'failed'){
            statusRTC.textContent = 'Conexão WebRTC falhou.'
        }
    }
    connection.onicecandidateerror = event => {
        if(pc !== connection) return


        log(`Aviso ICE: ${event.errorCode} - ` + `${event.errorText || 'Erro desconhecido'}`)
    }

    try{
        await connection.setRemoteDescription(description)

        if(pc !== connection) return

        remoteReady = true

        const answer = await connection.createAnswer()

        await connection.setLocalDescription(answer)

        if(pc !== connection) return

        if(!send({
            type: 'webrtc:answer',
            sdp: connection.localDescription.toJSON()
        })){
            throw new Error('Não foi possivel enviar a resposta SDP.')    
        }

        answerSent = true

        for(const candidate of pendingLocalCandidates){
            send(candidate)
        }

        pendingLocalCandidates.length = 0

        log('Resposta SDP enviada ao transmissor.')

        await drainCandidates(connection)
    }catch(e){
        log(`Falha na negociação SDP: ${e.message}`)

        if(pc === connection){
            closePeer()
        }
    }
}

async function handleMessage(message){
    switch(message.type){
        case 'viewer:ready':
            authenticated = true

            iceServers = Array.isArray(message.iceServers) ? message.iceServers : []
            statusRTC.textContent = 'Autenticado. Aguardando oferta WebRTC...'

            log(`Autenticado. Configurações ICE:` + `${iceServers.length}`)

            updateButtons()
            break
        case "webrtc:offer":
            log('Oferta SDP recebida.')
            await receiveOffer(message.sdp)
            break
        case 'webrtc:ice':
            pendingRemoteCandidates.push(message.candidate ?? null)

            if(pc){
                await drainCandidates(pc)
            }
            break
        case 'stream:ended':
            log('O transmissor encerrou a sessão')
            closePeer()
            statusRTC.textContent = 'Transmissão encerrada.'
            break
        case 'error':
            log(`Servidor:~${message.message || 'Erro desconhecido'}`)
            statusRTC.textContent = 'Erro de sinalização.'
            break
        default:
            log(`Mensagem desconhecida: ${message.type}`)
    }
}

function connect(){
    if(socket) return

    let token = keyInput.value.trim()

    if(!token) {
        statusRTC.textContent = 'Informe a chave de visualização.'
        return
    }

    const url = new URL('/ws-webrtc', location.href)

    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'

    if(url.protocol === 'ws:' && !['localhost', '127.0.0.1'].includes(url.hostname)){
        statusRTC.textContent = 'HTTP/WSS é obrigatório fora do localhost.'
        return
    }

    const ws = new WebSocket(url)

    socket = ws

    statusRTC.textContent = 'Conectnado ao servidor WebRTC...'

    updateButtons()

    ws.addEventListener('open', () => {
        if(socket !== ws) return

        ws.send(JSON.stringify({
            type: 'viewer:join',
            token
        }))

        token = ''
        keyInput.value = ''
    })

    ws.addEventListener('message' , event => {
        if(socket !== ws || typeof event.data !== 'string') return

        let message

        try{
            message = JSON.parse(event.data)
        }catch{
            log('Mensagem inválida do servidor.')
            return
        }

        handleMessage(message).catch(error => {
            log(`Falha na sinalização: ${error.message}`)
        })
    })
    ws.addEventListener('close' , event => {
        if(socket !== ws) return

        log(`WebSocket fechado: ${event.code}.`)
        disconnect()
    })
    ws.addEventListener('error' , () => {
        log('Erro na conexão WebSocket.')
    })
}

soundButton.addEventListener('click', async () => {
    video.muted = !video.muted

    try{
        await video.play()
    }catch(e){
        log(`Erro ao reproduzir audio: ${e.message}`)
        video.muted = true
    }

    updateButtons()
})

connectButton.addEventListener('click', connect)
disconnectButton.addEventListener('click', disconnect)

window.addEventListener('pagehide', () => {
    disconnect()
})

updateButtons()