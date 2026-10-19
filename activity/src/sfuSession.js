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

        } catch (error) {
            this.close()
            throw error
        }
    }

    async publish(stream, preferredCodec = 'h264') {
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

    async stopPublishing() {
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
    }

    startStats(callback) {
        this.stopStats()

        if (typeof callback !== 'function') return

        const medir = (report, stats, now) => {
            if (!report) return null

            const previous = this.previousStats.get(report.id)
            const codec = stats.get(report.codecId)?.mimeType ?? null

            const outbound = this.role === 'publisher'

            const bytes = outbound
                ? report.bytesSent
                : report.bytesReceived

            const frames = outbound
                ? report.framesEncoded
                : report.framesDecoded

            let bitrate = null
            let fps = null

            if (previous) {
                const seconds = (now - previous.time) / 1000

                if (seconds > 0) {
                    if (
                        Number.isFinite(bytes) &&
                        Number.isFinite(previous.bytes)
                    ) {
                        bitrate = Math.max(
                            0,
                            (bytes - previous.bytes) * 8 / seconds
                        )
                    }

                    if (
                        Number.isFinite(frames) &&
                        Number.isFinite(previous.frames)
                    ) {
                        fps = Math.max(
                            0,
                            (frames - previous.frames) / seconds
                        )
                    }
                }
            }

            this.previousStats.set(report.id, {
                time: now,
                bytes,
                frames
            })

            return {
                codec,
                bitrate,
                fps: fps ?? report.framesPerSecond ?? null,
                width: report.frameWidth ?? null,
                height: report.frameHeight ?? null,
                packetsLost: report.packetsLost ?? null,
                framesDropped: report.framesDropped ?? null,
                jitterMs: Number.isFinite(report.jitter)
                    ? report.jitter * 1000
                    : null,
                encoder: report.encoderImplementation ?? null,
                limitation: report.qualityLimitationReason ?? null
            }
        }

        const atualizar = async () => {
            if (
                this.closed ||
                !this.transport ||
                this.transport.closed ||
                this.transport.connectionState !== 'connected'
            ) return

            try {
                const stats = await this.transport.getStats()

                if (this.closed) return

                const reports = [...stats.values()]

                const type = this.role === 'publisher'
                    ? 'outbound-rtp'
                    : 'inbound-rtp'

                const encontrar = kind => reports.find(report =>
                    report.type === type &&
                    (report.kind ?? report.mediaType) === kind &&
                    stats.get(report.codecId)
                        ?.mimeType?.toLowerCase() !== 'video/rtx'
                )

                const now = performance.now()

                const transportReport = reports.find(report =>
                    report.type === 'transport' &&
                    report.selectedCandidatePairId
                )

                const pair = stats.get(
                    transportReport?.selectedCandidatePairId
                ) ?? reports.find(report =>
                    report.type === 'candidate-pair' &&
                    report.state === 'succeeded' &&
                    report.nominated
                )

                const source = reports.find(report =>
                    report.type === 'media-source' &&
                    (report.kind ?? report.mediaType) === 'video'
                )

                callback({
                    state: this.transport.connectionState,
                    video: medir(encontrar('video'), stats, now),
                    audio: medir(encontrar('audio'), stats, now),
                    rttMs: Number.isFinite(pair?.currentRoundTripTime)
                        ? pair.currentRoundTripTime * 1000
                        : null,
                    capturedFps: source?.framesPerSecond ?? null
                })

            } catch (error) {
                if (!this.closed) {
                    console.warn(
                        '[SFU] Estatísticas indisponíveis:',
                        error.message
                    )
                }
            }
        }

        this.statsTimer = setInterval(atualizar, 3000)
        atualizar()
    }

    stopStats() {
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
        Number.isFinite(value)
            ? value.toFixed(digits)
            : 'n/d'

    const bitrate = (value, unit) => {
        const divisor = unit === 'Mbps' ? 1_000_000 : 1_000

        return `${number(
            Number.isFinite(value) ? value / divisor : null,
            2
        )} ${unit}`
    }

    return [
        `WebRTC: ${data.state}`,
        `Codec: ${data.video?.codec ?? 'n/d'}`,
        `Resolução: ${data.video?.width ?? '?'}x${data.video?.height ?? '?'}`,
        `FPS vídeo: ${number(data.video?.fps)}`,
        `FPS capturados: ${number(data.capturedFps)}`,
        `Bitrate vídeo: ${bitrate(data.video?.bitrate, 'Mbps')}`,
        `Bitrate áudio: ${bitrate(data.audio?.bitrate, 'kbps')}`,
        `RTT ICE: ${number(data.rttMs)} ms`,
        `Pacotes perdidos: ${data.video?.packetsLost ?? 'n/d'}`,
        `Jitter: ${number(data.video?.jitterMs)} ms`,
        `Frames descartados: ${data.video?.framesDropped ?? 'n/d'}`,
        `Encoder: ${data.video?.encoder ?? 'n/d'}`,
        `Limitação: ${data.video?.limitation ?? 'n/d'}`
    ].join('\n')
}