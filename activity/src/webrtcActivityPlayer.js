import './assets/css/webrtcActivityPlayer.css'

export function montarPlayerWebRTC(container, clientId, obterTicketDiscord){
    if(!container) throw new Error('Container do WebRTC não encontrado.')
    if(!/^\d{17,20}$/.test(String(clientId))) throw new Error('Client ID do Discord invalido')

    const section = document.createElement('section')
    section.classList.add('demo-live-player')

    section.innerHTML = 
        `
        <hr>
        <h3>Central Player de Transmissões</h3>

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
            Conectar ao catalogo
        </button>

        <button id="rtc-disconnect" disabled>
            Desconectar
        </button>

        <div id="rtc-stream-catalog">
            <h4>Transmissões disponiveis</h4>
            <p id="rtc-stream-summary">Conecte-se para consultar a lista.</p>
            <div id="rtc-stream-list"></div>
        </div>

        <div id="rtc-player-panel">
            <div id="rtc-player-header">
                <strong>Reprodução WebRTC</strong>
                <span id="rtc-player-state" data-state="idle" role="status" aria-live="polite">
                    <span id="rtc-player-state-label">
                        Aguardando
                    </span>
                </span>
            </div>
            <div id="rtc-video-frame">
                <video
                    id="rtc-video"
                    autoplay
                    muted
                    playsinline
                    controls
                ></video>

                <div id="rtc-video-placeholder">
                    Selecione uma transmissão para assistir.
                </div>
            </div>

            <div id="rtc-player-controls">
                <span id="rtc-current-stream">
                    Nenhuma transmissão selecionada
                </span>

                <button id="rtc-sound" type="button" disabled>
                    Ativar som
                </button>
            </div>
        </div>

        <details id="rtc-codec-settings">
            <summary>
                <span>Configurações de vídeo</span>
                <span id="rtc-codec-summary">
                    Automático
                </span>
            </summary>

            <div class="rtc-codec-content">
                <label class="rtc-codec-auto-label">
                    <input type="checkbox" id="rtc-codec-auto">
                    Seleção automática de codec
                </label>

                <label for="rtc-codec-select">
                    Codec manual:
                </label>

                <select id="rtc-codec-select">
                    <option value="h264">H.264</option>
                    <option value="av1">AV1</option>
                    <option value="vp8">VP8</option>
                </select>

                <p id="rtc-codec-info">
                    Carregando preferências...
                </p>

                <p id="rtc-codec-current">
                    Codec recebido: aguardando transmissão.
                </p>
            </div>
        </details>
            
        <details id="rtc-diagnostics">
            <summary>
                Diagnóstico técnico
            </summary>

            <pre id="rtc-logs"></pre>
        </details>

        `


    container.appendChild(section);

    const statusRTC = section.querySelector('#rtc-status');
    const keyInput = section.querySelector('#rtc-key');

    const connectButton = section.querySelector('#rtc-connect');
    const disconnectButton = section.querySelector('#rtc-disconnect');
    const soundButton = section.querySelector('#rtc-sound');

    const playerPanel = section.querySelector('#rtc-player-panel')
    const currentStream = section.querySelector('#rtc-current-stream')
    const playerState = section.querySelector('#rtc-player-state')
    const playerStateLabel = section.querySelector('#rtc-player-state-label')
    const videoPlaceholder = section.querySelector('#rtc-video-placeholder')

    const video = section.querySelector('#rtc-video');
    const logs = section.querySelector('#rtc-logs');

    const streamSummary = section.querySelector('#rtc-stream-summary')
    const streamList = section.querySelector('#rtc-stream-list')

    const codecAuto = section.querySelector('#rtc-codec-auto');
    const codecSelect = section.querySelector('#rtc-codec-select');
    const codecInfo = section.querySelector('#rtc-codec-info');
    const codecSummary = section.querySelector('#rtc-codec-summary')
    const codecCurrent = section.querySelector('#rtc-codec-current')

    const CODEC_STORAGE_KEY = 'demo_live:codec-preferences:v1'

    const SUPPORTED_CODECS = ['h264', 'av1', 'vp8']

    const DEFAULT_CODEC_PREFERENCES = {
        automatic: true,
        manualCodec: 'h264',
        lastWorkingCodec: null
    }


    let socket = null;
    let authenticated = false;
    let connectingSocket = false

    let cachedViewerToken = null
    let authenticatingViewerToken = null

    let selectedStreamId = null
    let activeNegotiationId = null
    let pendingStreamId = null
    let leavingStream = false
    let latestStreams = []

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


    const PLAYER_STATES = {
        idle: {
            label: 'Aguardando',
            placeholder: 'Selecione uma transmissão para assistir.'
        },
        connecting: {
            label: 'Conectando',
            placeholder: 'Estabelecendo conexão WebRTC...'
        },
        connected: {
            label: 'Conectado',
            placeholder: 'Aguardando reprodução do vídeo...'
        },
        waiting: {
            label: 'Aguardando transmissão',
            placeholder: 'O transmissor ainda não iniciou o compartilhamento.'
        },
        live: {
            label: 'Reproduzindo',
            placeholder: ''
        },
        reconnecting: {
            label: 'Reconectando',
            placeholder: 'Tentando restabelecer a conexão...'
        },
        failed: {
            label: 'Falha',
            placeholder: 'Não foi possível estabelecer a conexão.'
        },
        ended: {
            label: 'Encerrada',
            placeholder: 'O transmissor encerrou a transmissão.'
        },
        leaving: {
            label: 'Saindo',
            placeholder: 'Saindo da transmissão...'
        }
    }

    function setPlayerState(state) {
        const config = PLAYER_STATES[state]

        if (!config) return

        playerState.dataset.state = state
        playerStateLabel.textContent = config.label

        videoPlaceholder.textContent = config.placeholder
    }

    function criarAvatarEspectador(user){
        const name = user.global_name || user.username || 'Espectador'

        const avatar = document.createElement('span')
        avatar.className = 'rtc-stream-card__avatar'
        avatar.title = name
        avatar.setAttribute('role', 'img')
        avatar.setAttribute('aria-label', name)

        const fallback = document.createElement('span')
        fallback.textContent = name.charAt(0).toUpperCase() || '?'
        avatar.appendChild(fallback)

        const validId = typeof user.id === 'string' &&
            /^\d{17,20}$/.test(user.id)

        const validAvatar = typeof user.avatar === 'string' &&
            /^[a-zA-Z0-9_]+$/.test(user.avatar)

        if(validId && validAvatar){
            const image = document.createElement('img')
            image.alt = ''
            image.loading = 'lazy'
            image.decoding = 'async'

            image.src = `https://cdn.discordapp.com/avatars/` + `${user.id}/${user.avatar}.webp?size=64`

            image.onerror = () => image.remove()

            avatar.appendChild(image)
        }

        return avatar

    }

    function renderStreamList(items){

        if(Array.isArray(items)){
            latestStreams = items
        }

        currentStream.textContent = leavingStream
            ? 'Saindo da transmissão...'
            : selectedStreamId
                ? `Transmissão ${selectedStreamId.slice(0, 8)}`
                : pendingStreamId
                    ? `Conectando a transmissão ${pendingStreamId.slice(0, 8)}`
                    : 'Nenhuma tranmissão selecionada'

        const streams = latestStreams
            .filter(stream => stream && 
                typeof stream.id === 'string' && 
                (stream.status === 'idle' || stream.status === 'live'))
            .sort((a,b) => Number(b.status === 'live') - Number(a.status === 'live'))

        streamList.replaceChildren()

        const liveCount = streams.filter(stream => stream.status === 'live').length

        streamSummary.textContent = `${liveCount} ao vivo · ${streams.length} registradas`

        if(streams.length === 0){
            const empty = document.createElement('p')

            empty.className = 'rtc-stream-empty'
            empty.textContent = 'Nenhuma transmissão cadastrada no momento.'

            streamList.appendChild(empty)
            return
        }

        for(const stream of streams){
            const isLive = stream.status === 'live'
            const isWatching = selectedStreamId === stream.id
            const isPending = pendingStreamId === stream.id

            const card = document.createElement('article')
            card.className = 'rtc-stream-card'

            if(isLive) card.classList.add('is-live')
            if(isWatching) card.classList.add('is-selected')


            const header = document.createElement('div')
            header.className = 'rtc-stream-card__header'

            const title = document.createElement('strong')
            title.className = 'rtc-stream-card__title'
            title.textContent = `Transmissão ${stream.id.slice(0, 8)}`

            const status = document.createElement('span')
            status.className = 'rtc-stream-card__status'

            status.textContent = isLive
                ? 'Ao vivo'
                : 'Aguardando'

            header.append(title, status)

            const footer = document.createElement('div')
            footer.className = 'rtc-stream-card__footer'

            const description = document.createElement('span')
            description.className = 'rtc-stream-card__description'
            

            if(isWatching){
                description.textContent = 'Assistindo agora'
            }else if(isPending){
                description.textContent = 'Conectando...'
            }else {
                description.textContent = isLive
                    ? 'Disponivel'
                    : 'Captura não iniciada'
            }

            const action = document.createElement('button')
            action.type = 'button'
            action.className = 'rtc-stream-card__action'

            if(isWatching){
                action.textContent = leavingStream
                    ? 'Saindo...'
                    : 'Sair'
                action.classList.add('is-leave')
                action.disabled = leavingStream
                action.addEventListener('click', leaveStream)
            }else if(isPending){
                action.textContent = 'Conectando...'
                action.disabled = true
            }else{
                action.textContent = isLive
                    ? 'Assistir'
                    : 'Aguardar'
                action.disabled = !authenticated || selectedStreamId !== null || pendingStreamId !== null
                action.addEventListener('click', () => {
                    watchStream(stream.id)
                })
            }

            footer.append(description, action)

            const viewerCount = Number.isInteger(stream.viewerCount)
                ? Math.max(0, stream.viewerCount)
                : 0
            const participants = Array.isArray(stream.participants)
                ? [
                    ...new Map(stream.participants
                            .filter(user => user && typeof user.id === 'string')
                            .map(user => [user.id, user])
                        ).values()
                ]
                : []

            const audience = document.createElement('div')
            audience.className = 'rtc-stream-card__audience'

            const count = document.createElement('span')
            count.className = 'rtc-stream-card__audience-count'

            count.textContent = viewerCount === 1
                ? '1 espectador assistindo'
                : `${viewerCount} espectadores assistindo`
            
            audience.appendChild(count)

            if(participants.length > 0){
                const content = document.createElement('div')
                content.className = 'rtc-stream-card__audience-content'

                const avatars = document.createElement('div')
                avatars.className = 'rtc-stream-card__avatars'

                const MAX_AVATARS = 5

                for(const user of participants.slice(0, MAX_AVATARS)){
                    avatars.appendChild(criarAvatarEspectador(user))
                }

                const remaining = participants.length - MAX_AVATARS

                if(remaining > 0){
                    const extra = document.createElement('span')
                    extra.className = 'rtc-stream-card__avatar rtc-stream-card__avatar--extra'
                    extra.textContent = `+${remaining}`
                    extra.title = `${remaining} participantes adicionais`

                    avatars.appendChild(extra)
                }

                const names = document.createElement('span')
                names.className = 'rtc-stream-card__audience-names'
                
                const visibleNames = participants.slice(0, 3).map(
                    user => user.global_name || user.username || 'Espectador'
                )

                names.textContent = visibleNames.join(', ')

                if(participants.length > 3){
                    names.textContent += ` e mais ${participants.length - 3}`
                }

                content.append(avatars, names)
                audience.appendChild(content)
            }

            card.append(header, audience, footer)
            streamList.appendChild(card)
        }
    }

    function watchStream(streamId){
        if(!authenticated || selectedStreamId || pendingStreamId) return

        const available = latestStreams.some(stream => stream.id === streamId &&
             (stream.status === 'live' || stream.status === 'idle')
            )

        if(!available) return

        resetAutoCodecOrder()
        notifyCodecPreference()
        pendingStreamId = streamId
        renderStreamList()

        if(!send({
            type: 'viewer:watch',
            streamId
        })){
            pendingStreamId = null
            renderStreamList()
            return
        }

        setPlayerState('connecting')

        statusRTC.textContent = 'Solicitando transmissão...'

        log(`Solicitada transmissão ${streamId.slice(0, 8)}.`)
    }

    function leaveStream(){
        if(!authenticated || !selectedStreamId || leavingStream) return

        if(!send({
            type: 'viewer:leave'
        })) return

        leavingStream = true
        activeNegotiationId = null

        closePeer()
        setPlayerState('leaving')
        renderStreamList()

        statusRTC.textContent = 'Saindo da transmissão...'

        log(`Saindo da transmissão ${selectedStreamId.slice(0, 8)}.`)
    }

    function loadCodecPreferences(){
        try{
            const saved = localStorage.getItem(CODEC_STORAGE_KEY)

            if(!saved){
                return {...DEFAULT_CODEC_PREFERENCES}
            }

            const parsed = JSON.parse(saved)

            return{
                automatic: typeof parsed.automatic === 'boolean'
                    ? parsed.automatic
                    : true,
                manualCodec: SUPPORTED_CODECS.includes(parsed.manualCodec)
                    ? parsed.manualCodec
                    : 'h264',
                lastWorkingCodec: SUPPORTED_CODECS.includes(parsed.lastWorkingCodec)
                    ? parsed.lastWorkingCodec
                    : null
            }
        }catch(e){
            console.warn('[Demo Live] Cache indisponivel: ', e)
            return {...DEFAULT_CODEC_PREFERENCES}
        }
    }

    let codecPreferences = loadCodecPreferences()

    let autoCodecOrder = []
    let autoCodecIndex = 0

    function resetAutoCodecOrder(){
        const first = codecPreferences.lastWorkingCodec ?? 'h264'

        autoCodecOrder = [
            first,
            ...SUPPORTED_CODECS.filter(codec => codec !== first)
        ]

        autoCodecIndex = 0
    }

    resetAutoCodecOrder()

    function saveCodecPreferences(){
        try{
            localStorage.setItem(CODEC_STORAGE_KEY, JSON.stringify(codecPreferences))

            return true
        }catch(e){
            console.warn('[Demo Live] Falha ao salvar preferencias: ', e)
            return false
        }
    }

    function getRequestedCodec(){
        if(!codecPreferences.automatic){
            return codecPreferences.manualCodec
        }

        return autoCodecOrder[autoCodecIndex] ?? 'h264'
    }

    function getCodecRequest(){
        return {
            codecMode: codecPreferences.automatic ? 'auto' : 'manual',
            codec: getRequestedCodec()
        }
    }

    function notifyCodecPreference(){
        if(!authenticated) return

        const request = getCodecRequest()

        if(send({
            type: 'webrtc:codec-request',
            ...request
        })){
            log(
                `Preferência enviada: ${request.codec.toUpperCase()} ` +
                `(${request.codecMode})`
            )
        }
    }

    const AUTO_CODEC_TIMEOUT_MS = 8_000

    let autoCodecTimeout = null
    let videoFrameCallbackId = null
    let videoLoadedListener = null

    function stopAutoCodecWatch(){
        if(autoCodecTimeout !== null){
            clearTimeout(autoCodecTimeout)
            autoCodecTimeout = null
        }
        if(videoFrameCallbackId !== null && typeof video.cancelVideoFrameCallback === 'function'){
            video.cancelVideoFrameCallback(videoFrameCallbackId)
        }

        videoFrameCallbackId = null

        if(videoLoadedListener){
            video.removeEventListener('loadeddata', videoLoadedListener)
            videoLoadedListener = null
        }
    }

    function tryNextAutomaticCodec(reason){
        if(!codecPreferences.automatic) return

        if(autoCodecIndex >= autoCodecOrder.length - 1){
            log(
                `Todos os codecs foram testados sem reprodução. ` +
                `Última falha: ${reason}`
            )
            setPlayerState('failed')
            statusRTC.textContent = 'Nenhum codec conseguiu reproduzir o vídeo.'

            return
        }

        const previousCodec = getRequestedCodec()

        autoCodecIndex++

        const nextCodec = getRequestedCodec()

        log(
            `${previousCodec.toUpperCase()} falhou: ${reason}. ` +
            `Tentando ${nextCodec.toUpperCase()}...`
        )

        setPlayerState('connecting')
        notifyCodecPreference()
    }

    function startAutoCodecWatch(pc){
        stopAutoCodecWatch()

        if(!codecPreferences.automatic || connection !== pc) return

        const attemptedCodec = getRequestedCodec()
        let confirmed = false

        function confirmPlayback(){
            if(confirmed || connection !== pc || !codecPreferences.automatic || getRequestedCodec() !== attemptedCodec) return

            confirmed = true

            stopAutoCodecWatch()

            codecPreferences.lastWorkingCodec = attemptedCodec

            saveCodecPreferences()
            updateCodecControls()

            log(
                `Reprodução confirmada com ${attemptedCodec.toUpperCase()}. ` +
                `Codec salvo no cache.`
            )
        }

        autoCodecTimeout = setTimeout(() => {
            if(confirmed || connection !== pc || !codecPreferences.automatic) return

            stopAutoCodecWatch()

            tryNextAutomaticCodec(`nenhum quadro apresentado em ${AUTO_CODEC_TIMEOUT_MS / 1000}s`)
        }, AUTO_CODEC_TIMEOUT_MS)

        if(typeof video.requestVideoFrameCallback === 'function'){
            videoFrameCallbackId = video.requestVideoFrameCallback(() => {
                videoFrameCallbackId = null
                confirmPlayback()
            })
        }else{
            videoLoadedListener = () => {
                if(video.readyState >= 2 && video.videoWidth > 0){
                    confirmPlayback()
                }
            }
            video.addEventListener('loadeddata', videoLoadedListener)
            videoLoadedListener()
        }

        log(
            `Verificando reprodução com ${attemptedCodec.toUpperCase()} ` +
            `(${AUTO_CODEC_TIMEOUT_MS / 1000}s).`
        )
    }


    function updateCodecControls(){
        codecAuto.checked = codecPreferences.automatic

        codecSelect.disabled = codecPreferences.automatic
        codecSelect.value = codecPreferences.manualCodec

        if(codecPreferences.automatic){
            const last = codecPreferences.lastWorkingCodec

            codecInfo.textContent = last
                ? `Automático ativado. Ultimo codec funcional: ${last.toUpperCase()}.`
                : 'Automático ativado. Nenhum codec funcional salvo.'
        }else{
            codecInfo.textContent = `Codec manual escolhido: ${codecPreferences.manualCodec.toUpperCase()}`
        }
        codecSummary.textContent = codecPreferences.automatic
            ? 'Automático'
            : `Manual · ${codecPreferences.manualCodec.toUpperCase()}`
    }

    function updateButtons() {
        connectButton.disabled = socket !== null || connectingSocket;
        disconnectButton.disabled = socket === null;

        const hasAudio = remoteStream?.getAudioTracks().some(track => track.readyState === 'live');

        soundButton.disabled = !hasAudio;

        soundButton.textContent = video.muted ? 'Ativar som' : 'Silenciar';
    }

    video.addEventListener('playing', () => {
        playerPanel.classList.add('is-playing')

        if(connection?.connectionState === 'connected'){
            setPlayerState('live')
        }
    })
    video.addEventListener('pause', () => {
        playerPanel.classList.remove('is-playing')
        if(connection?.connectionState === 'connected'){
            setPlayerState('connected')
        }
    })

    function send(message) {
        if (!authenticated ||socket?.readyState !== WebSocket.OPEN) {
            return false;
        }

        socket.send(JSON.stringify(message));
        return true;
    }

    function closePeer(){
        stopAutoCodecWatch()

        const oldConnection = connection

        stopPerformanceMonitor()

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

        codecCurrent.textContent = 'Codec recebido: aguardando transmissão.'

        playerPanel.classList.remove('is-playing')

        updateButtons();
    }

    function disconnect() {
        const oldSocket = socket;

        authenticatingViewerToken = null

        socket = null;
        authenticated = false;
        iceServers = [];

        selectedStreamId = null
        activeNegotiationId = null
        pendingStreamId = null
        leavingStream = false

        closePeer();
        setPlayerState('idle')
        renderStreamList([])

        streamSummary.textContent = 'Conecte-se para consultar a lista.'

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

    let performanceTimer = null

    function stopPerformanceMonitor(){
        if(performanceTimer !== null){
            clearInterval(performanceTimer)
            performanceTimer = null
        }
    }

    function startPerformanceMonitor(pc){
        stopPerformanceMonitor()

        let previous = null

        performanceTimer = setInterval(async () => {
            if(connection !== pc || pc.connectionState !== 'connected') return

            try{
                const stats = await pc.getStats()

                if(connection !== pc) return

                const videoStats = [...stats.values()].find(report => 
                    report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')
                )

                if(!videoStats) return

                const codecReport = videoStats.codecId
                    ? stats.get(videoStats.codecId)
                    : null

                if(videoStats.framesDecoded > 0 && codecReport?.mimeType){
                    const codecLabel = `Codec recebido: ${codecReport.mimeType}`

                    if(codecCurrent.textContent !== codecLabel){
                        codecCurrent.textContent = codecLabel
                    }
                }

                if (videoStats.framesDecoded === 0) {
                    const codec = stats.get(videoStats.codecId)

                    log(
                        `DIAGNOSTICO VIDEO: ` +
                        `Codec=${codec?.mimeType ?? 'n/d'}, ` +
                        `Decoder=${videoStats.decoderImplementation ?? 'n/d'}, ` +
                        `Frames recebidos=${videoStats.framesReceived ?? 'n/d'}, ` +
                        `Frames decodificados=${videoStats.framesDecoded ?? 'n/d'}, ` +
                        `Keyframes decodificados=${videoStats.keyFramesDecoded ?? 'n/d'}, ` +
                        `PLI=${videoStats.pliCount ?? 'n/d'}, ` +
                        `NACK=${videoStats.nackCount ?? 'n/d'}, ` +
                        `Video readyState=${video.readyState}`
                    )
                }


                const quality = video.getVideoPlaybackQuality?.()

                const current = {
                    time: performance.now(),
                    decoded: videoStats.framesDecoded ?? 0,
                    dropped: videoStats.framesDropped ?? 0,
                    packetsLost: videoStats.packetsLost ?? 0,
                    bytes: videoStats.bytesReceived ?? 0,
                    displayDropped: quality?.droppedVideoFrames ?? 0
                }

                if(previous){
                    const seconds = (current.time - previous.time) / 1000
                    const fps = (current.decoded - previous.decoded) / seconds
                    const bitrate = (current.bytes - previous.bytes) * 8 / seconds / 1000

                    const decoderDrops = current.dropped - previous.dropped
                    const displayDrops = current.displayDropped - previous.displayDropped
                    const lostPackets = current.packetsLost - previous.packetsLost

                    log(
                        `Desempenho: FPS decodificados=${fps.toFixed(1)},` +
                        `bitrate=${bitrate.toFixed(0)} kbps,` +
                        `drops decoder=${decoderDrops},` +
                        `drops exibição=${displayDrops},` +
                        `pacotes perdidos=${lostPackets}`
                    )
                }
                previous = current
            }catch(e){
                log(`Erro no monitor: ${e.message}`)
            }
        }, 3000)
    }

    async function receiveOffer(description, negotiationId,streamId){
        if(!authenticated ||
            selectedStreamId !== streamId ||
            activeNegotiationId !== negotiationId
        ) return

        if(!description || description.type !== 'offer' || typeof description.sdp !== 'string'){
            log('Oferta SDP invalida')
            return
        }

        const RTCCtor = typeof window.RTCPeerConnection === 'function'
                ? window.RTCPeerConnection
                : typeof window.webkitRTCPeerConnection === 'function'
                    ? window.webkitRTCPeerConnection
                    : null

        if (!RTCCtor) {
            statusRTC.textContent = 'Nenhum construtor WebRTC disponível nesta Activity.'
            log('WebRTC indisponível neste ambiente.')
            return
        }

        log(`Construtor selecionado: ${RTCCtor.name}`)

        closePeer()

        let pc

        try {
            pc = new RTCCtor({iceServers,iceTransportPolicy: 'all'})
        } catch (error) {
            statusRTC.textContent ='Não foi possível criar a conexão WebRTC.'

            log(`Erro ao criar RTCPeerConnection: ${error.message}`)
            return
        }

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
            if(connection !== pc ||
                activeNegotiationId !== negotiationId ||
                selectedStreamId !== streamId
            ) return

            const message = {
                type: 'webrtc:ice',
                streamId,
                negotiationId,
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
            if(state === 'failed'){
                statusRTC.textContent = 'Falha ICE. Verifique a configuração TURN.'
                setPlayerState('failed')
            }
        }
        pc.onconnectionstatechange = () => {
            if(connection !== pc) return

            const state = pc.connectionState

            log(`Conexão WebRTC: ${state}`)

            switch (state) {
                case 'connecting':
                    setPlayerState('connecting')
                    break

                case 'connected':
                    statusRTC.textContent = 'Transmissão WebRTC conectada.'
                    setPlayerState(video.paused ? 'connected' : 'live')
                    startPerformanceMonitor(pc)
                    startAutoCodecWatch(pc)
                    break

                case 'disconnected':
                    statusRTC.textContent = 'Conexão temporariamente interrompida.'
                    setPlayerState('reconnecting')
                    break

                case 'failed':
                    statusRTC.textContent = 'Falha na conexão WebRTC.'
                    setPlayerState('failed')
                    break
    }
        }
        pc.onicecandidateerror = event => {
            if(connection !== pc) return

            log(`Aviso ICE: código ${event.errorCode}`)
        }

        try{
            await pc.setRemoteDescription(description)

            if(connection !== pc ||
                activeNegotiationId !== negotiationId ||
                selectedStreamId !== streamId
            ) return

            remoteReady = true

            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)

            if(connection !== pc ||
                activeNegotiationId !== negotiationId ||
                selectedStreamId !== streamId
            ) return

            if(!send({
                type: 'webrtc:answer',
                streamId,
                negotiationId,
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

            if(connection === pc && activeNegotiationId === negotiationId){
                closePeer()

                if(codecPreferences.automatic){
                    tryNextAutomaticCodec(`negociação SDP falhou: ${error.message}`)
                }
            }
        }
    }

    async function handleMessage(message) {
        if(!message || typeof message !== 'object' || typeof message.type !== 'string')return

        switch(message.type){
            case 'viewer:ready':
                authenticated = true

                if(message.discordIdentity?.id){
                    log(
                        `Identidade Discord verificada: ` +
                        `${message.discordIdentity.username}`
                    )
                }else {
                    log('Espectador conectado sem identidade Discord verificada.')
                }


                cachedViewerToken = authenticatingViewerToken
                authenticatingViewerToken = null

                iceServers = Array.isArray(message.iceServers) ? message.iceServers : []

                statusRTC.textContent = 'Autenticado. Aguardando transmissão.'

                log(`Autenticado. Configurações ICE: ` + `${iceServers.length}`)
                setPlayerState('idle')
                updateButtons()
                renderStreamList()
                break
            case 'streams:snapshot':
                renderStreamList(message.streams)
                break
            case 'viewer:watching': 
                if(typeof message.streamId !== 'string') break

                selectedStreamId = message.streamId
                activeNegotiationId = null
                pendingStreamId = null
                leavingStream = false
                
                const currentStream = latestStreams.find(
                    stream => stream.id === selectedStreamId
                )

                const isWatching = currentStream?.status === 'idle'

                setPlayerState(isWatching ? 'waiting' : 'connecting')
                renderStreamList()

                statusRTC.textContent = isWatching
                    ? 'Aguardando o transmissor compartilhar a tela...'
                    : 'Aguardando oferta WebRTC.'

                log(`Assistindo à transmissão ${selectedStreamId.slice(0, 8)}.`)
                break
            case 'viewer:unwatched':
                selectedStreamId = null
                pendingStreamId = null
                leavingStream = false
                activeNegotiationId = null

                closePeer()
                setPlayerState('idle')
                renderStreamList()

                statusRTC.textContent = 'Escolha uma transmissão para assistir.'

                log('Você saiu da transmissão.')
                break

            case 'webrtc:offer':
                if(message.streamId !== selectedStreamId || typeof message.negotiationId !== 'string') break
                activeNegotiationId = message.negotiationId
                log(`Oferta SDP recebida: ` +  `${activeNegotiationId.slice(0, 8)}.`)
                setPlayerState('connecting')
                await receiveOffer(message.sdp, message.negotiationId, message.streamId)
                break
            case 'webrtc:ice':
                if(message.streamId !== selectedStreamId || 
                    message.negotiationId !== activeNegotiationId ||
                    !activeNegotiationId
                ) break

                pendingRemoteICE.push(message.candidate ?? null)

                if(connection){
                    await drainCandidates(connection)
                }

                break
            case 'viewer:departed':
                if(message.streamId !== selectedStreamId || typeof message.viewerId !== 'string') break
                log(`O espectador ${message.viewerId.slice(0, 8)} ` + `saiu da transmissão.`)
                break
            case 'stream:ended':
                if(message.streamId && message.streamId !== selectedStreamId) break

                activeNegotiationId = null

                closePeer()

                statusRTC.textContent = 'Transmissão encerrada.'
                setPlayerState('waiting')
                log('O transmissor encerrou a sessão.')
                break
            case 'error':

                if(!authenticated){
                    cachedViewerToken = null
                    authenticatingViewerToken = null
                }

                statusRTC.textContent = 'Erro de sinalização.'

                log(`Servidor: ${message.message || 'Erro desconhecido'}`)

                pendingStreamId = null
                leavingStream = false
                renderStreamList()

                break
            default: 
                log(`Mensagem recebida: ${message.type}`)
        }
    }

    async function connect(){
        if(socket || connectingSocket) return

        resetAutoCodecOrder()

        let token = keyInput.value.trim() || cachedViewerToken

        if(!token){
            statusRTC.textContent = 'Informe a chave de visualização.'
            return
        }

        
        authenticatingViewerToken = token

        connectingSocket = true
        updateButtons()

        let identityTicket

        try{
            if (typeof obterTicketDiscord !== 'function'){
                throw new Error('Autenticação Discord indisponivel.')
            }
            identityTicket = await obterTicketDiscord()
        }catch(e){
            statusRTC.textContent = 'Falha na identificação Discord.'

            log(`Identidade Discord: ${e.message}`)

            return
        }finally{
            connectingSocket = false
            updateButtons()
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
                token,
                identityTicket,
                autoWatch: false,
                ...getCodecRequest()
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

    codecAuto.addEventListener('change', () => {
        codecPreferences.automatic = codecAuto.checked

        stopAutoCodecWatch()
        resetAutoCodecOrder()
        saveCodecPreferences()
        updateCodecControls()
        notifyCodecPreference()

        log(`Seleção automática de codec:` + `${codecPreferences.automatic ? 'ativada' : 'desativada'}`)
    })

    codecSelect.addEventListener('change', () => {
        const selectedCodec = codecSelect.value

        if(!SUPPORTED_CODECS.includes(selectedCodec)) return

        codecPreferences.manualCodec = selectedCodec

        stopAutoCodecWatch()
        saveCodecPreferences()
        updateCodecControls()
        notifyCodecPreference()

        log(`Codec manual selecionado: ${selectedCodec.toUpperCase()}`)
    })

    connectButton.addEventListener('click', connect)
    disconnectButton.addEventListener('click', disconnect)

    window.addEventListener('pagehide', disconnect, { once: true })

    updateButtons()
    updateCodecControls()

    return {disconnect}
}