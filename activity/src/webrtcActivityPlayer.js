export function montarPlayerWebRTC(container, clientId){
    if(!container) throw new Error('Container do WebRTC não encontrado.')
    if(!/^\d{17,20}$/.test(String(clientId))) throw new Error('Client ID do Discord invalido')

    const section = document.createElement('section')
    

    section.innerHTML = 
        `
        <hr>
        <h3>Player WebRTC (teste)</h3>

        <p id="rtc-status">
            Informe a chave para assistir.
        </p>

        <input
            id="rtc-key"
            type="password"
            placeholder="Chave de visualização"
            autocomplete="off"
        >

        <button id="rtc-connect">
            Assistir via WebRTC
        </button>

        <button id="rtc-disconnect" disabled>
            Desconectar
        </button>

        <button id="rtc-sound" disabled>
            Ativar som
        </button>

        <video
            id="rtc-video"
            autoplay
            muted
            playsinline
            controls
            style="
                display:block;
                width:100%;
                max-width:960px;
                background:black;
                margin-top:12px;
            "
        ></video>

        <pre id="rtc-logs" style="white-space:pre-wrap;max-height:200px;overflow:auto;"></pre>
        `

        container.appendChild(section);

    const statusRTC = section.querySelector('#rtc-status');
    const keyInput = section.querySelector('#rtc-key');

    const connectButton = section.querySelector('#rtc-connect');
    const disconnectButton = section.querySelector('#rtc-disconnect');
    const soundButton = section.querySelector('#rtc-sound');

    const video = section.querySelector('#rtc-video');
    const logs = section.querySelector('#rtc-logs');

    let socket = null;
    let authenticated = false;

    let connection = null;
    let remoteStream = null;

    let iceServers = [];

    let remoteReady = false;
    let answerSent = false;
    let draining = false;

    let pendingRemoteICE = [];
    let pendingLocalICE = [];

    function log(message) {
        console.log('[Activity WebRTC]', message);

        logs.textContent += `${message}\n`;

        if (logs.textContent.length > 8000) {
            logs.textContent = logs.textContent.slice(-6000);
        }

        logs.scrollTop = logs.scrollHeight;
    }

    function updateButtons() {
        connectButton.disabled = socket !== null;
        disconnectButton.disabled = socket === null;

        const hasAudio = remoteStream?.getAudioTracks().some(track => track.readyState === 'live');

        soundButton.disabled = !hasAudio;

        soundButton.textContent = video.muted ? 'Ativar som' : 'Silenciar';
    }

    function send(message) {
        if (!authenticated ||socket?.readyState !== WebSocket.OPEN) {
            return false;
        }

        socket.send(JSON.stringify(message));
        return true;
    }

    function closePeer(){
        const oldConnection = connection

        connection = null

        if(oldConnection){
            oldConnection.ontrack = null
            oldConnection.onicecandidate = null
            oldConnection.oniceconnectionstatechange = null
            oldConnection.onconnectionstatechange = null
            oldConnection.onicecandidateerror = null

            oldConnection.close()
        }

        remoteReady = false;
        answerSent = false;
        draining = false;

        pendingRemoteICE = [];
        pendingLocalICE = [];

        remoteStream = null;

        video.pause();
        video.srcObject = null;
        video.muted = true;

        updateButtons();
    }

    function disconnect() {
        const oldSocket = socket;

        socket = null;
        authenticated = false;
        iceServers = [];

        closePeer();

        if (oldSocket && oldSocket.readyState < WebSocket.CLOSING) {
            oldSocket.close(1000, 'Espectador saiu');
        }

        statusRTC.textContent = 'Desconectado.';

        updateButtons();
    }

    async function drainCandidates(pc){
        if(connection !== pc || !remoteReady || draining || pc.signalingState === 'closed') return

        draining = true

        try{
            while(connection === pc && pendingRemoteICE.length && pc.signalingState !== 'closed'){
                const candidate = pendingRemoteICE.shift()

                try{
                    await pc.addIceCandidate(candidate)
                }catch(e){
                    log(`Candidato ICE rejeitado: ${e.message}`)
                }
            }
        }finally{
            draining = false
        }
    }

    async function diagnoseICE(pc){
        try{
            const stats = await pc.getStats()

            if(connection !== pc) return

            const reports = [...stats.values()]

            const transport = reports.find(report => report.type === 'transport' && report.selectedCandidatePairId)

            const pair = transport ? stats.get(transport.selectedCandidatePairId) : reports.find(report => 
                report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated === true
            )

            if(!pair){
                log('ICE conectado. Aguardando estatisticas da rota.')
                return
            }

            const local = stats.get(pair.localCandidateId)
            const remote = stats.get(pair.remoteCandidateId)

            log(`Rota ICE: local=${local?.candidateType || 'n/d'},` + `remote=${remote?.candidateType || 'n/d'}`)
        
        }catch(e){
            log(`Diagnostico ICE: ${e.message}`)
        }
    }

    async function receiveOffer(description){
        if(!authenticated) return

        if(!description || description.type !== 'offer' || typeof description.sdp !== 'string'){
            log('Oferta SDP invalida')
            return
        }

        if (typeof window.RTCPeerConnection !== 'function') {
            statusRTC.textContent = 'WebRTC não disponível nesta Activity. Utilize o player MSE.'

            log('RTCPeerConnection indisponível neste ambiente.')
            return
        }

        closePeer()

        const pc = new RTCPeerConnection({
            iceServers,
            iceTransportPolicy: 'all'
        })

        connection = pc

        const stream = new MediaStream()

        remoteStream = stream
        video.srcObject = stream
        video.muted = true

        pc.ontrack = event => {
            if(connection !== pc) return

            const track = event.track

            if(!stream.getTracks().some(existing => existing.id === track.id)){
                stream.addTrack(track)
            }

            log(`Faixa recebida: ${track.kind}`)

            track.addEventListener('ended', () => {
                if(connection !== pc) return

                log(`Faixa encerrada: ${track.kind}`)
                updateButtons()
            }, { once: true })

            updateButtons()

            video.play().catch(error => {
                log(`Autoplay: ${error.message}`)
            })
        }
        pc.onicecandidate = event => {
            if(connection !== pc) return

            const message = {
                type: 'webrtc:ice',
                candidate: event.candidate ? event.candidate.toJSON() : null
            }

            if(!answerSent){
                pendingLocalICE.push(message)
            }else{
                send(message)
            }
        }
        pc.oniceconnectionstatechange = () => {
            if(connection !== pc) return

            const state = pc.iceConnectionState

            log(`ICE: ${state}`)

            if(state === 'connected' || state === 'completed') diagnoseICE(pc)
            if(state === 'failed') statusRTC.textContent = 'Falha ICE. Verifique a configuração TURN.'
        }
        pc.onconnectionstatechange = () => {
            if(connection !== pc) return

            const state = pc.connectionState

            log(`Conexão WebRTC: ${state}`)

            if(state === 'connected') {
                statusRTC.textContent = 'Transmissão WebRTC conectada.'
            }
            if(state === 'disconnected'){
                statusRTC.textContent = 'Conexão temporariamente interrompida.'
            }
            if(state === 'failed'){
                statusRTC.textContent = 'Falha na conexão WebRTC'
            }
        }
        pc.onicecandidateerror = event => {
            if(connection !== pc) return

            log(`Aviso ICE: código ${event.errorCode}`)
        }

        try{
            await pc.setRemoteDescription(description)

            if(connection !== pc) return

            remoteReady = true

            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)

            if(connection !== pc) return

            if(!send({
                type: 'webrtc:answer',
                sdp: pc.localDescription.toJSON()
            })){
                throw new Error('Não foi possivel enviar a resposta SDP')
            }

            answerSent = true

            for(const candidate of pendingLocalICE){
                send(candidate)
            }

            pendingLocalICE.length = 0

            log('Resposta SDP enviada.')

            await drainCandidates(pc)
        }catch(error){
            log(`Erro de negociação: ${error.message}`)

            if(connection === pc){
                closePeer()
            }
        }
    }

    async function handleMessage(message) {
        if(!message || typeof message !== 'object' || typeof message.type !== 'string')return

        switch(message.type){
            case 'viewer:ready':
                authenticated = true

                iceServers = Array.isArray(message.iceServers) ? message.iceServers : []

                statusRTC.textContent = 'Autenticado. Aguardando transmissão.'

                log(`Autenticado. Configurações ICE: ` + `${iceServers.length}`)

                updateButtons()
                break
            case 'webrtc:offer':
                log('Oferta SDP recebida.')
                await receiveOffer(message.sdp)
                break
            case 'webrtc:ice':
                pendingRemoteICE.push(message.candidate ?? null)

                if(connection){
                    await drainCandidates(connection)
                }

                break
            case 'stream:ended':
                closePeer()

                statusRTC.textContent = 'Transmissão encerrada.'

                log('O transmissor encerrou a sessão.')
                break
            case 'error':
                statusRTC.textContent = 'Erro de sinalização.'

                log(`Servidor: ${message.message || 'Erro desconhecido'}`)

                break
            default: 
                log(`Mensagem recebida: ${message.type}`)
        }
    }

    function connect(){
        if(socket) return

        let token = keyInput.value.trim()

        if(!token){
            statusRTC.textContent = 'Informe a chave de visualização.'
            return
        }

        const url = `wss://${clientId}.discordsays.com/.proxy/ws-webrtc`

        const ws = new WebSocket(url)

        socket = ws

        statusRTC.textContent = 'Conectando a sinalização...'

        updateButtons()

        ws.addEventListener('open', () => {
            if(socket !== ws) return

            ws.send(JSON.stringify({
                type: 'viewer:join',
                token
            }))

            token = ''
            keyInput.value = ''

            statusRTC.textContent = 'Autenticando...'
        })

        ws.addEventListener('message', event => {
            if(socket !== ws || typeof event.data !== 'string') return

            let message

            try{
                message = JSON.parse(event.data)
            }catch{
                log('Message invalida recebida.')
                return
            }

            handleMessage(message).catch(error => {
                log(`Sinalização: ${error.message}`)
            })
        })

        ws.addEventListener('close', event => {
            if(socket !== ws) return

            log(`WebSocket fechado: ${event.code}`)

            disconnect()
        })

        ws.addEventListener('error', () => {
            log('Erro na conexão WebSocket.')
        })
    }

    soundButton.addEventListener('click', async () => {
        video.muted = !video.muted

        try{
            await video.play()
        }catch(e){
            log(`Erro de reprodução: ${e.message}`)
            video.muted = true
        }
        updateButtons()
    })

    connectButton.addEventListener('click', connect)
    disconnectButton.addEventListener('click', disconnect)

    window.addEventListener('pagehide', disconnect, { once: true })

    updateButtons()

    return {disconnect}
}