import { Device } from 'mediasoup-client'

export class SfuSession {
    constructor({
        role,
        roomId,
        url,
        onEvent = () => {},
        onClose = () => {}
    }) {
        this.role = role
        this.roomId = roomId
        this.url = url
        this.onEvent = onEvent
        this.onClose = onClose

        this.socket = null
        this.device = null
        this.transport = null

        this.pending = new Map()
        this.requestId = 0

        this.producers = new Map()
        this.consumers = new Map()
        this.closed = false
        this.statsTimer = null

        this.previousStats = new Map()
        this.statsGeneration = 0

        this.mediaQueue = Promise.resolve()
        this.keepAliveTimer = null
        this.keepAliveInFlight = false
    }

    request(type, data = {}) {
        if (
            this.closed ||
            this.socket?.readyState !== WebSocket.OPEN
        ) {
            return Promise.reject(new Error('SFU desconectado'))
        }

        return new Promise((resolve, reject) => {
            const id = ++this.requestId

            const timer = setTimeout(() => {
                this.pending.delete(id)
                reject(new Error('SFU demorou: ' + type))
            }, 10000)

            this.pending.set(id, {
                resolve,
                reject,
                timer
            })

            this.socket.send(JSON.stringify({
                id,
                type,
                data
            }))
        })
    }

    enqueueMedia(action) {
        const operation = this.mediaQueue
            .catch(() => {})
            .then(() => {
                if (this.closed) {
                    throw new Error('SFU encerrado')
                }

                return action()
            })

        this.mediaQueue = operation.catch(() => {})

        return operation
    }

    async connect(token) {
        this.socket = new WebSocket(this.url)
        const socket = this.socket

        socket.addEventListener('message', event => {
            let msg

            try {
                msg = JSON.parse(event.data)
            } catch {
                return
            }

            if (msg.event) {
                this.onEvent(msg)
                return
            }

            const waiting = this.pending.get(msg.id)
            if (!waiting) return

            clearTimeout(waiting.timer)
            this.pending.delete(msg.id)

            if (msg.ok) {
                waiting.resolve(msg.data)
            } else {
                waiting.reject(
                    new Error(
                        msg.error || 'SFU recusou solicitacao'
                    )
                )
            }
        })

        socket.addEventListener('close', event => {
            console.error('[SFU] WebSocket encerrado:', {
                role: this.role,
                roomId: this.roomId,
                code: event.code,
                reason: event.reason || 'Sem motivo informado',
                wasClean: event.wasClean
            })

            if (this.closed) return

            this.close()

            this.onClose({
                code: event.code,
                reason: event.reason || 'WebSocket encerrado'
            })
        })

        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error('Timeout na conexao SFU'))
                }, 10000)

                socket.addEventListener('open', () => {
                    clearTimeout(timer)
                    resolve()
                }, { once: true })

                socket.addEventListener('error', () => {
                    clearTimeout(timer)
                    reject(new Error('Falha no WebSocket SFU'))
                }, { once: true })

                socket.addEventListener('close', () => {
                    clearTimeout(timer)
                    reject(new Error('WebSocket SFU encerrou'))
                }, { once: true })
            })

            await this.request('authenticate', { token })

            const constructors = [
            ['RTCPeerConnection', window.RTCPeerConnection],
            ['webkitRTCPeerConnection', window.webkitRTCPeerConnection]
        ]

        let rtcCtor = null

        for (const [name, Ctor] of constructors) {
            if (typeof Ctor !== 'function') {
                console.log(`[SFU] ${name} indisponivel:`, typeof Ctor)
                continue
            }

            try {
                const test = new Ctor({ iceServers: [] })
                test.close()

                rtcCtor = Ctor
                console.log(`[SFU] Construtor WebRTC funcional: ${name}`)
                break
            } catch (error) {
                console.warn(`[SFU] ${name} falhou:`, error.message)
            }
        }

        if (!rtcCtor) {
            throw new Error(
                'Nenhum construtor RTCPeerConnection funcional na Activity.'
            )
        }

        if (window.RTCPeerConnection !== rtcCtor) {
            window.RTCPeerConnection = rtcCtor
        }

        this.device = new Device()
        console.log('[SFU] Handler mediasoup:', this.device.handlerName)

            await this.device.load({
                routerRtpCapabilities:
                    await this.request('capabilities')
            })

            const params = await this.request(
                'create-transport',
                {
                    direction: this.role === 'publisher'
                        ? 'send'
                        : 'recv'
                }
            )

            this.transport = this.role === 'publisher'
                ? this.device.createSendTransport(params)
                : this.device.createRecvTransport(params)

            this.transport.on('connectionstatechange', state => {
                this.onEvent({
                    event: 'transport-state',
                    state
                })

                if (state === 'failed' && !this.closed) {
                    this.close()
                    this.onClose({
                        reason: 'Transporte WebRTC falhou'
                    })
                }
            })

            this.transport.on(
                'connect',
                ({ dtlsParameters }, callback, errback) => {
                    this.request('connect-transport', {
                        transportId: this.transport.id,
                        dtlsParameters
                    })
                    .then(callback)
                    .catch(errback)
                }
            )

            if (this.role === 'publisher') {
                this.transport.on(
                    'produce',
                    ({ kind, rtpParameters }, callback, errback) => {
                        this.request('produce', {
                            transportId: this.transport.id,
                            kind,
                            rtpParameters
                        })
                        .then(({ id }) => callback({ id }))
                        .catch(errback)
                    }
                )
            }
         
        this.startKeepAlive()

        console.log('[SFU] Keepalive de sinalização ativado.')

        } catch (error) {
            this.close()
            throw error
        }
    }

    publish(stream, preferredCodec = 'av1') {
        return this.enqueueMedia(async () => {
            if (this.role !== 'publisher' || !this.transport) {
                throw new Error('SFU publisher nao preparado')
            }

            const videoTrack = stream.getVideoTracks()[0]

            if (!videoTrack) {
                throw new Error('Captura sem video')
            }

            const codec = this.device.sendRtpCapabilities.codecs.find(
                c => c.mimeType.toLowerCase() ===
                    `video/${preferredCodec}`
            )

            if (!codec) {
                throw new Error(
                    'Codec nao suportado: ' + preferredCodec
                )
            }

            const video = await this.transport.produce({
                track: videoTrack,
                codec,
                encodings: [
                    { maxBitrate: 8_000_000 }
                ],
                stopTracks: false
            })

            this.producers.set('video', video)

            const audioTrack = stream.getAudioTracks()[0]

            if (
                audioTrack &&
                this.device.canProduce('audio')
            ) {
                const audio = await this.transport.produce({
                    track: audioTrack,
                    stopTracks: false
                })

                this.producers.set('audio', audio)
            }
        })
    }

    
    replaceCaptureTracks(videoTrack, audioTrack = null) {
        return this.enqueueMedia(async () => {

            if (this.role !== 'publisher' || !this.transport) {
                throw new Error('SFU publisher não preparado.')
            }

            if (
                !videoTrack ||
                videoTrack.kind !== 'video' ||
                videoTrack.readyState !== 'live'
            ) {
                throw new Error('Nova track de vídeo inválida.')
            }

            if (
                audioTrack &&
                (
                    audioTrack.kind !== 'audio' ||
                    audioTrack.readyState !== 'live'
                )
            ) {
                throw new Error('Nova track de áudio inválida.')
            }

            const videoProducer = this.producers.get('video')
            const audioProducer = this.producers.get('audio') ?? null

            if (!videoProducer || videoProducer.closed) {
                throw new Error('Producer de vídeo indisponível.')
            }

            if (audioProducer?.closed) {
                throw new Error('Producer de áudio encerrado.')
            }

            const previousAudioTrack = audioProducer?.track ?? null

            let audioChanged = false

            try {
                if (audioProducer) {
                    await audioProducer.replaceTrack({
                        track: audioTrack ?? null
                    })

                    audioChanged = true
                }

                await videoProducer.replaceTrack({
                    track: videoTrack
                })

            } catch (error) {

                if (audioChanged && audioProducer && !audioProducer.closed) {
                    try {
                        await audioProducer.replaceTrack({
                            track:
                                previousAudioTrack?.readyState === 'live'
                                    ? previousAudioTrack
                                    : null
                        })
                    } catch (rollbackError) {
                        console.error(
                            '[SFU] Falha ao restaurar áudio:',
                            rollbackError
                        )
                    }
                }

                throw error
            }

            return {
                videoProducerId: videoProducer.id,
                audioProducerId: audioProducer?.id ?? null,
                audioActive: Boolean(audioProducer && audioTrack)
            }
        })
    }



    async watch() {
        if (this.role !== 'viewer' || !this.transport) {
            throw new Error('SFU viewer nao preparado')
        }

        const stream = new MediaStream()

        for (const kind of ['video', 'audio']) {
            let params

            try {
                params = await this.request('consume', {
                    kind,
                    transportId: this.transport.id,
                    rtpCapabilities:
                        this.device.recvRtpCapabilities
                })
            } catch (error) {
                if (
                    kind === 'audio' &&
                    error.message.includes(
                        'Producer audio indisponivel'
                    )
                ) {
                    continue
                }

                throw error
            }

            const consumer = await this.transport.consume(params)

            this.consumers.set(kind, consumer)
            stream.addTrack(consumer.track)
        }

        if (!this.consumers.has('video')) {
            throw new Error('SFU nao forneceu video')
        }

        for (const consumer of this.consumers.values()) {
            await this.request('resume-consumer', {
                consumerId: consumer.id
            })
        }

        return stream
    }

    stopPublishing() {
        return this.enqueueMedia(async () => {
            if (this.role !== 'publisher') return

            for (const producer of this.producers.values()) {
                producer.close()
            }

            this.producers.clear()

            if (
                this.socket?.readyState === WebSocket.OPEN &&
                !this.closed
            ) {
                await this.request('stop')
            }
        })
    }

    startKeepAlive() {
        this.stopKeepAlive()

        this.keepAliveTimer = setInterval(async () => {
            if (
                this.closed ||
                this.keepAliveInFlight ||
                this.socket?.readyState !== WebSocket.OPEN
            ) return

            this.keepAliveInFlight = true

            try {
                await this.request('ping')
            } catch (error) {
                if (!this.closed) {
                    console.warn(
                        '[SFU] Keepalive falhou:',
                        error.message
                    )
                }
            } finally {
                this.keepAliveInFlight = false
            }
        }, 15000)
    }

    stopKeepAlive() {
        if (this.keepAliveTimer !== null) {
            clearInterval(this.keepAliveTimer)
            this.keepAliveTimer = null
        }
    }

    startStats(callback) {
        this.stopStats()
        if (typeof callback !== 'function') return

        const generation = this.statsGeneration
        const outbound = this.role === 'publisher'
        let running = false

        const getMediaStats = async kind => {
            const media = (outbound ? this.producers : this.consumers).get(kind)

            if (!media || media.closed) return null

            const stats = await media.getStats()

            if (media.closed) return null

            return { media, stats }
        }

        const measure = (entry, kind) => {
            if (!entry) return null

            const { media, stats } = entry
            const expectedSsrc = media.rtpParameters?.encodings?.[0]?.ssrc

            const primaryCodec = media.rtpParameters?.codecs?.find(codec =>
                codec.mimeType?.toLowerCase() !== 'video/rtx'
            )

            const type = outbound ? 'outbound-rtp' : 'inbound-rtp'

            const reports = [...stats.values()].filter(report =>
                report.type === type &&
                ((!report.kind && !report.mediaType) ||
                    (report.kind ?? report.mediaType) === kind)
            )

            const score = report => {
                const mime = stats.get(report.codecId)?.mimeType?.toLowerCase()

                return (
                    (expectedSsrc != null &&
                        String(report.ssrc) === String(expectedSsrc) ? 100 : 0) +
                    (mime && mime === primaryCodec?.mimeType?.toLowerCase() ? 50 : 0) +
                    (kind === 'video' &&
                        Number.isFinite(
                            outbound ? report.framesEncoded : report.framesDecoded
                        ) ? 20 : 0) -
                    (mime === 'video/rtx' ? 100 : 0)
                )
            }

            reports.sort((a, b) => score(b) - score(a))

            const report = reports[0]
            if (!report) return null

            const key = `${kind}:${media.id}:${report.id}`
            const previous = this.previousStats.get(key)

            const time = Number.isFinite(report.timestamp)
                ? report.timestamp
                : performance.now()

            const bytes = outbound ? report.bytesSent : report.bytesReceived
            const frames = outbound ? report.framesEncoded : report.framesDecoded
            const packets = outbound ? report.packetsSent : report.packetsReceived
            const lost = report.packetsLost

            let bitrate = null
            let fps = null
            let packetLossPercent = null

            if (previous && time > previous.time) {
                const seconds = (time - previous.time) / 1000

                if (Number.isFinite(bytes) && Number.isFinite(previous.bytes)) {
                    bitrate = Math.max(0, (bytes - previous.bytes) * 8 / seconds)
                }

                if (Number.isFinite(frames) && Number.isFinite(previous.frames)) {
                    fps = Math.max(0, (frames - previous.frames) / seconds)
                }

                if (
                    !outbound &&
                    Number.isFinite(packets) &&
                    Number.isFinite(lost) &&
                    Number.isFinite(previous.packets) &&
                    Number.isFinite(previous.lost)
                ) {
                    const received = Math.max(0, packets - previous.packets)
                    const lostNow = Math.max(0, lost - previous.lost)

                    if (received + lostNow > 0) {
                        packetLossPercent =
                            lostNow * 100 / (received + lostNow)
                    }
                }
            }

            this.previousStats.set(key, {
                time,
                bytes,
                frames,
                packets,
                lost
            })

            const settings = media.track?.getSettings?.()

            return {
                codec: primaryCodec?.mimeType ??
                    stats.get(report.codecId)?.mimeType ?? null,
                width: report.frameWidth ?? settings?.width ?? null,
                height: report.frameHeight ?? settings?.height ?? null,
                bitrate,
                fps: fps ?? report.framesPerSecond ?? null,
                packetsLost: outbound ? null : lost ?? null,
                packetLossPercent,
                jitterMs: Number.isFinite(report.jitter)
                    ? report.jitter * 1000
                    : null,
                framesDropped: report.framesDropped ?? null,
                encoder: outbound
                    ? report.encoderImplementation ?? null
                    : null,
                limitation: outbound
                    ? report.qualityLimitationReason ?? null
                    : null
            }
        }

        const update = async () => {
            if (
                running ||
                this.closed ||
                generation !== this.statsGeneration ||
                this.transport?.connectionState !== 'connected'
            ) return

            running = true

            try {
                const [videoData, audioData, transportStats] = await Promise.all([
                    getMediaStats('video').catch(() => null),
                    getMediaStats('audio').catch(() => null),
                    this.transport.getStats().catch(() => null)
                ])

                if (this.closed || generation !== this.statsGeneration) return

                const reports = transportStats
                    ? [...transportStats.values()]
                    : []

                const transportReport = reports.find(report =>
                    report.type === 'transport' &&
                    report.selectedCandidatePairId
                )

                const pair = transportStats?.get(
                    transportReport?.selectedCandidatePairId
                ) ?? reports.find(report =>
                    report.type === 'candidate-pair' &&
                    report.state === 'succeeded' &&
                    report.nominated
                )

                const source = outbound
                    ? reports.find(report =>
                        report.type === 'media-source' &&
                        (report.kind ?? report.mediaType) === 'video'
                    )
                    : null

                callback({
                    role: this.role,
                    state: this.transport.connectionState,
                    video: measure(videoData, 'video'),
                    audio: measure(audioData, 'audio'),
                    rttMs: Number.isFinite(pair?.currentRoundTripTime)
                        ? pair.currentRoundTripTime * 1000
                        : null,
                    capturedFps: source?.framesPerSecond ?? null
                })

            } catch (error) {
                if (!this.closed) {
                    console.warn('[SFU] Estatísticas:', error)
                }
            } finally {
                running = false
            }
        }

        this.statsTimer = setInterval(() => void update(), 3000)
        void update()
    }


    stopStats() {
        this.statsGeneration++

        if (this.statsTimer !== null) {
            clearInterval(this.statsTimer)
            this.statsTimer = null
        }

        this.previousStats.clear()
    }

    close() {
        if (this.closed) return

        this.closed = true
        this.stopStats()
        this.stopKeepAlive()

        for (const waiter of this.pending.values()) {
            clearTimeout(waiter.timer)
            waiter.reject(new Error('SFU encerrado'))
        }

        this.pending.clear()

        for (const item of this.producers.values()) {
            item.close()
        }

        for (const item of this.consumers.values()) {
            item.close()
        }

        this.producers.clear()
        this.consumers.clear()

        this.transport?.close()
        this.socket?.close()
    }
}

export function formatSfuStats(data) {
    const number = (value, digits = 1) =>
        Number.isFinite(value) ? value.toFixed(digits) : 'n/d'

    const bitrate = (value, divisor, unit) =>
        Number.isFinite(value)
            ? `${(value / divisor).toFixed(2)} ${unit}`
            : 'n/d'

    const lines = [
        `WebRTC: ${data.state}`,
        `Codec: ${data.video?.codec ?? 'n/d'}`,
        `Resolução: ${data.video?.width ?? '?'}x${data.video?.height ?? '?'}`,
        `FPS vídeo: ${number(data.video?.fps)}`,
        `Bitrate vídeo: ${bitrate(data.video?.bitrate, 1_000_000, 'Mbps')}`,
        `Bitrate áudio: ${bitrate(data.audio?.bitrate, 1_000, 'kbps')}`,
        `RTT ICE: ${number(data.rttMs)} ms`
    ]

    if (data.role === 'publisher') {
        lines.push(
            `FPS capturados: ${number(data.capturedFps)}`,
            `Encoder: ${data.video?.encoder ?? 'n/d'}`,
            `Limitação: ${data.video?.limitation ?? 'n/d'}`
        )
    } else {
        lines.push(
            `Pacotes perdidos (total): ${data.video?.packetsLost ?? 'n/d'}`,
            `Perda no intervalo: ${
                Number.isFinite(data.video?.packetLossPercent)
                    ? number(data.video.packetLossPercent, 2) + '%'
                    : 'n/d'
            }`,
            `Jitter: ${number(data.video?.jitterMs)} ms`,
            `Frames descartados: ${data.video?.framesDropped ?? 'n/d'}`
        )
    }

    return lines.join('\n')
}