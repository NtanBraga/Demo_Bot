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
            this.onClose()
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

    close() {
        if (this.closed) return

        this.closed = true

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