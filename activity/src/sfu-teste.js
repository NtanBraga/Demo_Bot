
import { Device } from 'mediasoup-client'

const role = new URLSearchParams(location.search).get('role')

const connectButton = document.querySelector('#connect')
const publishButton = document.querySelector('#publish')
const watchButton = document.querySelector('#watch')
const stopButton = document.querySelector('#stop')
const video = document.querySelector('#video')
const status = document.querySelector('#status')
const logBox = document.querySelector('#logs')
const soundButton = document.querySelector('#sound')
const codecSettings = document.querySelector('#codec-settings')
const codecSelect = document.querySelector('#video-codec')
const statsBox = document.querySelector('#stats')
const fpsSelect = document.querySelector('#capture-fps')

if (!['publisher', 'viewer'].includes(role)) {
    status.textContent = 'Use ?role=publisher ou ?role=viewer'
    connectButton.disabled = true
}

publishButton.hidden = role !== 'publisher'
stopButton.hidden = role !== 'publisher'
watchButton.hidden = role !== 'viewer'
codecSettings.hidden = role !== 'publisher'

let statsInterval = null
let statsVersion = 0

let socket
let device
let transport
let producers = new Map()
let consumers = new Map()
let capture
let receivedStream = null

let nextId = 0
const pending = new Map()

function log(message) {
    console.log('[Teste SFU]', message)
    logBox.textContent += message + '\n'
}

function pararEstatisticas() {
    statsVersion++

    if (statsInterval !== null) {
        clearInterval(statsInterval)
    }

    statsInterval = null
    statsBox.textContent = 'Aguardando transmissão...'
}

function iniciarEstatisticas() {
    pararEstatisticas()

    const version = statsVersion
    const anteriores = new Map()

    let consultando = false

    async function atualizar() {
        if (consultando || !transport || transport.closed) return

        if (transport.connectionState !== 'connected') {
            statsBox.textContent = 'Aguardando conexão WebRTC...'
            return
        }

        consultando = true

        try {
            const stats = await transport.getStats()

            const videoEndpoint = role === 'publisher'
                ? producers.get('video')
                : consumers.get('video')

            const audioEndpoint = role === 'publisher'
                ? producers.get('audio')
                : consumers.get('audio')

            const [videoStats, audioStats] = await Promise.all([
                videoEndpoint && !videoEndpoint.closed
                    ? videoEndpoint.getStats()
                    : Promise.resolve(stats),

                audioEndpoint && !audioEndpoint.closed
                    ? audioEndpoint.getStats()
                    : Promise.resolve(stats)
            ])

            if (version !== statsVersion) return

            const reports = [...stats.values()]

            const tipo = role === 'publisher'
                ? 'outbound-rtp'
                : 'inbound-rtp'

            const codecDe = (item, fonte = stats) =>
                fonte.get(item?.codecId)?.mimeType ?? null

            const rtpDe = (kind, fonte = stats) =>
                [...fonte.values()].find(item =>
                    item.type === tipo &&
                    (item.kind ?? item.mediaType) === kind &&
                    codecDe(item, fonte)?.toLowerCase() !== 'video/rtx'
                )

            function medir(item, fonte = stats) {
                if (!item) return null

                const anterior = anteriores.get(item.id)

                const segundos = anterior
                    ? (item.timestamp - anterior.timestamp) / 1000
                    : 0

                const bytesCampo = role === 'publisher'
                    ? 'bytesSent'
                    : 'bytesReceived'

                const framesCampo = role === 'publisher'
                    ? 'framesEncoded'
                    : 'framesDecoded'

                let bps = null
                let fps = null
                let perda = null
                let descartados = null

                if (segundos > 0 && anterior) {

                    if (
                        Number.isFinite(item[bytesCampo]) &&
                        Number.isFinite(anterior.bytes)
                    ) {
                        bps = Math.max(0,item[bytesCampo] - anterior.bytes) * 8 / segundos
                    }

                    if (Number.isFinite(item[framesCampo]) && Number.isFinite(anterior.frames)) {
                        fps = Math.max(0,item[framesCampo] - anterior.frames) / segundos
                    }

                    if (
                        role === 'viewer' &&
                        Number.isFinite(item.packetsReceived) &&
                        Number.isFinite(item.packetsLost) &&
                        Number.isFinite(anterior.recebidos) &&
                        Number.isFinite(anterior.perdidos)
                    ) {
                        const recebidos = Math.max(0,item.packetsReceived - anterior.recebidos)

                        const perdidos = Math.max(0,item.packetsLost - anterior.perdidos)

                        if (recebidos + perdidos > 0) {
                            perda = 100 * perdidos / (recebidos + perdidos)
                        }
                    }

                    if (
                        role === 'viewer' &&
                        Number.isFinite(item.framesDropped) &&
                        Number.isFinite(anterior.descartados)
                    ) {
                        descartados = Math.max(0,item.framesDropped - anterior.descartados)
                    }
                }

                anteriores.set(item.id, {
                    timestamp: item.timestamp,
                    bytes: item[bytesCampo],
                    frames: item[framesCampo],
                    recebidos: item.packetsReceived,
                    perdidos: item.packetsLost,
                    descartados: item.framesDropped
                })

                return {
                    codec: codecDe(item, fonte),
                    bps,
                    fps: fps ?? item.framesPerSecond ?? null,
                    largura: item.frameWidth,
                    altura: item.frameHeight,
                    perda,
                    descartados,
                    jitterMs: Number.isFinite(item.jitter)
                        ? item.jitter * 1000
                        : null
                }
            }

            const video = medir(rtpDe('video', videoStats), videoStats)

            const audio = medir(rtpDe('audio', audioStats), audioStats)

            const envioVideo = role === 'publisher'
                ? rtpDe('video', videoStats)
                : null

            const codecNegociado = consumers.get('video')
                ?.rtpParameters.codecs.find(codec =>
                    codec.mimeType.toLowerCase().startsWith('video/') &&
                    codec.mimeType.toLowerCase() !== 'video/rtx'
                )?.mimeType


            const rtcTransport = reports.find(item =>
                item.type === 'transport' &&
                item.selectedCandidatePairId
            )

            const pair = stats.get(
                rtcTransport?.selectedCandidatePairId
            ) ?? reports.find(item =>
                item.type === 'candidate-pair' &&
                item.nominated &&
                item.state === 'succeeded'
            )

            const rttMs = Number.isFinite(pair?.currentRoundTripTime)
                ? pair.currentRoundTripTime * 1000
                : null

            const capturado = reports.find(item =>
                item.type === 'media-source' &&
                (item.kind ?? item.mediaType) === 'video'
            )?.framesPerSecond

            const formatar = (valor, casas = 1) =>
                Number.isFinite(valor)
                    ? valor.toFixed(casas)
                    : 'n/d'

            statsBox.textContent = [
                `Papel: ${role}`,
                `WebRTC: ${transport.connectionState}`,

                `Codec vídeo: ${video?.codec ?? codecNegociado ?? 'n/d'}`,

                `Resolução: ${video?.largura ?? '?'}x${video?.altura ?? '?'}`,

                ...(role === 'publisher'
                    ? [`FPS capturados: ${formatar(capturado)}`]
                    : []),

                `FPS ${role === 'publisher' ? 'codificados' : 'decodificados'}: ${formatar(video?.fps)}`,

                `Bitrate vídeo: ${formatar(
                    video?.bps == null ? null : video.bps / 1_000_000,
                    2
                )} Mbps`,

                `Bitrate áudio: ${formatar(
                    audio?.bps == null ? null : audio.bps / 1000,
                    0
                )} kbps`,

                ...(role === 'publisher' ? [
                    `Limitação de qualidade: ${
                        envioVideo?.qualityLimitationReason ?? 'n/d'
                    }`,

                    `Bitrate alvo do encoder: ${formatar(
                        Number.isFinite(envioVideo?.targetBitrate)
                            ? envioVideo.targetBitrate / 1_000_000
                            : null,
                        2
                    )} Mbps`,

                    `Encoder utilizado: ${
                        envioVideo?.encoderImplementation ?? 'n/d'
                    }`
                ] : []),



                ...(role === 'viewer' ? [
                    `Perda vídeo (intervalo): ${formatar(video?.perda, 2)}%`,
                    `Jitter vídeo: ${formatar(video?.jitterMs)} ms`,
                    `Jitter áudio: ${formatar(audio?.jitterMs)} ms`,
                    `Frames descartados (intervalo): ${video?.descartados ?? 'n/d'}`
                ] : []),

                `RTT ICE: ${formatar(rttMs)} ms`

            ].join('\n')

        } catch (error) {
            if (version === statsVersion) {
                statsBox.textContent = 'Erro nas estatísticas: ' + error.message
            }
        } finally {
            consultando = false
        }
    }

    statsInterval = setInterval(atualizar, 3000)

    atualizar()
}

function request(type, data = {}) {
    if (socket?.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('WebSocket nao conectado'))
    }

    return new Promise((resolve, reject) => {
        const id = ++nextId

        const timer = setTimeout(() => {
            pending.delete(id)
            reject(new Error('Tempo excedido: ' + type))
        }, 10000)

        pending.set(id, { resolve, reject, timer })

        socket.send(JSON.stringify({ id, type, data }))
    })
}

function handleMessage(event) {
    const msg = JSON.parse(event.data)

    if (msg.event === 'producer-closed') {
        const kind = msg.kind
        const consumer = consumers.get(kind)

        if (kind === 'video') {
            pararEstatisticas()
        }

        if(consumer){
            if(receivedStream) receivedStream.removeTrack(consumer.track)

            consumer.close()
            consumers.delete(kind)
        }

        log(`Producer ${kind} encerrado`)

        if(consumers.size === 0){
            receivedStream = null

            video.pause()
            video.srcObject = null

            watchButton.disabled = false
            status.textContent = 'Transmissão encerrada.'
        }

        if (kind === 'audio') {
            video.muted = true
            soundButton.hidden = true
        }

        return
    }
    

    const waiting = pending.get(msg.id)
    if (!waiting) return

    pending.delete(msg.id)
    clearTimeout(waiting.timer)

    if (msg.ok) {
        waiting.resolve(msg.data)
    } else {
        waiting.reject(new Error(msg.error))
    }
}

function bindTransportEvents() {
    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        request('connect-transport', {
            transportId: transport.id,
            dtlsParameters
        }).then(callback).catch(errback)
    })

    transport.on('connectionstatechange', state => {
        log('WebRTC ' + role + ': ' + state)
    })

    if (role === 'publisher') {
        transport.on('produce', (
            { kind, rtpParameters },
            callback,
            errback
        ) => {
            request('produce', {
                transportId: transport.id,
                kind,
                rtpParameters
            })
            .then(({ id }) => callback({ id }))
            .catch(errback)
        })
    }
}

connectButton.addEventListener('click', async () => {
    connectButton.disabled = true

    try {
        socket = new WebSocket(
            'ws://127.0.0.1:3004/?role=' + role
        )

        socket.addEventListener('message', handleMessage)

        await new Promise((resolve, reject) => {
            socket.addEventListener('open', resolve, { once: true })
            socket.addEventListener('error', () => {
                reject(new Error('Falha no WebSocket'))
            }, { once: true })
        })

        socket.addEventListener('close', () => {
            log('Sinalizacao encerrada')
            
            pararEstatisticas()

            for (const item of pending.values()) {
                clearTimeout(item.timer)
                item.reject(new Error('Sinalizacao encerrada'))
            }

            pending.clear()
            publishButton.disabled = true
            watchButton.disabled = true
        })

        device = new Device()

        await device.load({
            routerRtpCapabilities: await request('capabilities')
        })

        if (role === 'publisher') {
            const supportedCodecs = device.sendRtpCapabilities.codecs

            for (const option of codecSelect.options) {

                const mimeType = `video/${option.value}`

                const supported = supportedCodecs.some(
                    codec => codec.mimeType.toLowerCase() === mimeType
                )

                option.disabled = !supported
            }

            if (codecSelect.selectedOptions[0]?.disabled) {
                const fallback = [...codecSelect.options].find(
                    option => !option.disabled
                )

                if (!fallback) throw new Error('Nenhum codec de video disponivel')

                codecSelect.value = fallback.value
            }

            codecSelect.disabled = false

            log(
                'Codecs disponiveis para envio: ' +
                supportedCodecs
                    .filter(codec =>
                        ['video/vp8', 'video/h264', 'video/av1']
                            .includes(codec.mimeType.toLowerCase())
                    )
                    .map(codec => codec.mimeType)
                    .join(', ')
            )
        }



        const params = await request('create-transport', {
            direction: role === 'publisher' ? 'send' : 'recv'
        })

        transport = role === 'publisher'
            ? device.createSendTransport(params)
            : device.createRecvTransport(params)

        bindTransportEvents()

        log('Transport criado: ' + transport.id)

        log(
            'Codecs: ' +
            device.rtpCapabilities.codecs
                .map(codec => codec.mimeType)
                .join(', ')
        )

        if (role === 'publisher') {
            publishButton.disabled = false
        } else {
            watchButton.disabled = false
        }

        status.textContent = 'Sinalizacao pronta. Prossiga para WebRTC.'

    } catch (error) {
        log('Erro: ' + error.message)
        connectButton.disabled = false
        socket?.close()
    }
})

publishButton.addEventListener('click', async () => {
    publishButton.disabled = true

    try {

        const selectedCodecName = codecSelect.value

        const selectedCodec = device.sendRtpCapabilities.codecs.find(
            codec => codec.mimeType.toLowerCase() === `video/${selectedCodecName}`
        )

        if (!selectedCodec) throw new Error(`Codec ${selectedCodecName.toUpperCase()} nao suportado`)
        

        codecSelect.disabled = true
        fpsSelect.disabled = true
        pararEstatisticas()

        log(`Codec solicitado: ${selectedCodecName.toUpperCase()}`)

        capture = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: Number(fpsSelect.value) },
            audio: true
        })

        const track = capture.getVideoTracks()[0]

        video.srcObject = capture
        video.muted = true

        await video.play()

        if (!device.canProduce('video')) {
            throw new Error('Browser nao suporta codec de video negociado')
        }

        const MAX_VIDEO_BITRATE = 8_000_000

        const videoProducer = await transport.produce({
            track,
            codec: selectedCodec,
            encodings: [
                {
                    maxBitrate: MAX_VIDEO_BITRATE
                }
            ]
        })

        log(`Bitrate máximo configurado: ${ MAX_VIDEO_BITRATE / 1_000_000} Mbps`)

        producers.set('video', videoProducer)

        log('Video producer publicado: ' + videoProducer.id)

        const negotiatedCodec = videoProducer.rtpParameters.codecs.find(
            codec => codec.mimeType.toLowerCase().startsWith('video/') &&
                codec.mimeType.toLowerCase() !== 'video/rtx'
        )

        if (negotiatedCodec?.mimeType.toLowerCase() === 'video/h264') {
            log(
                'Perfil H264 negociado: ' +
                JSON.stringify(negotiatedCodec.parameters)
            )

            const h264Codecs = RTCRtpSender
                .getCapabilities('video')
                ?.codecs.filter(codec =>
                    codec.mimeType.toLowerCase() === 'video/h264'
                ) ?? []

            log('Perfis H264 do Chrome: ' + JSON.stringify(h264Codecs.map(codec => codec.sdpFmtpLine)))
        }


        log(
            'Codec negociado para envio: ' +
            (negotiatedCodec?.mimeType ?? 'desconhecido')
        )

        if (negotiatedCodec?.mimeType.toLowerCase() !== `video/${selectedCodecName}`) {
            throw new Error('Codec negociado diferente do solicitado')
        }

        const audioTrack = capture.getAudioTracks()[0]

        if(audioTrack){
            if(!device.canProduce('audio')){
                log('Codec de audio nao disponivel')
            }else{
                const audioProducer = await transport.produce({
                    track: audioTrack
                })
                producers.set('audio', audioProducer)

                log('Audio Producer publicado: ' + audioProducer.id)
            }
        }else{
            log('Nenhuma faixa de audio capturada')
        }

        stopButton.disabled = false
        status.textContent = 'Publisher transmitindo para a Azure.'

        iniciarEstatisticas()

        track.addEventListener('ended', () => {
            stopButton.click()
        }, { once: true })

    } catch (error) {
        log('Erro ao publicar: ' + error.message)
        publishButton.disabled = false
    }
})

stopButton.addEventListener('click', async () => {
    stopButton.disabled = true

    pararEstatisticas()

    for(const producer of producers.values()){
        producer.close()
    }

    producers.clear()

    capture?.getTracks().forEach(track => track.stop())
    capture = null
    video.srcObject = null

    try {
        await request('stop')
    } catch (error) {

         log('Erro ao publicar: ' + error.message)

        for (const producer of producers.values()) {
            producer.close()
        }

        producers.clear()

        capture?.getTracks().forEach(track => track.stop())
        capture = null

        video.pause()
        video.srcObject = null

        if (socket?.readyState === WebSocket.OPEN) {
            try {
                await request('stop')
            } catch (e) {
                log('Erro ao limpar publicacao: ' + e.message)
            }
        }

        pararEstatisticas()

        codecSelect.disabled = false
        fpsSelect.disabled = false
        publishButton.disabled = false
    }

    publishButton.disabled = false
    codecSelect.disabled = false
    fpsSelect.disabled = false
    status.textContent = 'Transmissao encerrada.'
})

watchButton.addEventListener('click', async () => {
    watchButton.disabled = true

    try {
        receivedStream = new MediaStream()

        const kinds = ['video', 'audio']

        for(const kind of kinds){
            let params

            try{
                params = await request('consume', {
                    transportId: transport.id,
                    rtpCapabilities: device.recvRtpCapabilities,
                    kind
                })
            }catch(e){
                if(kind === 'audio' && e.message === 'Producer audio indisponivel'){
                    log('Publisher nao disponibilizou audio')
                    continue
                }
                throw e
            }

            const consumer = await transport.consume(params)

            consumers.set(kind, consumer)
            receivedStream.addTrack(consumer.track)

            if (kind === 'video') {
                const receivedCodec = consumer.rtpParameters.codecs.find(codec =>
                    codec.mimeType.toLowerCase().startsWith('video/') &&
                    codec.mimeType.toLowerCase() !== 'video/rtx'
                )

                log('Codec de video recebido: ' + (receivedCodec?.mimeType ?? 'desconhecido'))
            }


            log(`Consumer ${kind} criado: ${consumer.id}`)
        }

        if(!consumers.has('video')){
            throw new Error('Nenhum consumer de video disponivel')
        }

        video.srcObject = receivedStream
        video.muted = true

        for(const consumer of consumers.values()){
            await request('resume-consumer', {
                consumerId: consumer.id
            })
            log(`Consumer ${consumer.kind} retomado`)
        }

        await video.play()

        soundButton.hidden = !consumers.has('audio')
        soundButton.textContent = 'Ativar som'

        status.textContent = 'Viewer recebendo video e audio da Azure.'

        log('Reproducao SFU iniciada.')
        iniciarEstatisticas()

    } catch (error) {
        log('Erro ao assistir: ' + error.message)
        
        pararEstatisticas()

        for(const consumer of consumers.values()){
            consumer.close()
        }
        consumers.clear()

        receivedStream = null
        video.srcObject = null

        watchButton.disabled = false
        soundButton.hidden = true
    }
})
soundButton.addEventListener('click', async () => {
    video.muted = !video.muted

    soundButton.textContent = video.muted
        ? 'Ativar som'
        : 'Silenciar'

    if (!video.muted) {
        try {
            await video.play()
        } catch (error) {
            video.muted = true
            soundButton.textContent = 'Ativar som'

            log('Erro ao ativar audio: ' + error.message)
        }
    }
})
