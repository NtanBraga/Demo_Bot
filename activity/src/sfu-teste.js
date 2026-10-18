
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

if (!['publisher', 'viewer'].includes(role)) {
    status.textContent = 'Use ?role=publisher ou ?role=viewer'
    connectButton.disabled = true
}

publishButton.hidden = role !== 'publisher'
stopButton.hidden = role !== 'publisher'
watchButton.hidden = role !== 'viewer'

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
        capture = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 30 },
            audio: true
        })

        const track = capture.getVideoTracks()[0]

        video.srcObject = capture
        video.muted = true

        await video.play()

        if (!device.canProduce('video')) {
            throw new Error('Browser nao suporta codec de video negociado')
        }

        const vp8 = device.rtpCapabilities.codecs.find(
            codec => codec.mimeType.toLowerCase() === 'video/vp8'
        )

        const videoProducer = await transport.produce({
            track,
            ...(vp8 ? { codec: vp8 } : {})
        })

        producers.set('video', videoProducer)

        log('Video producer publicado: ' + videoProducer.id)

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
        log(error.message)
    }

    publishButton.disabled = false
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

    } catch (error) {
        log('Erro ao assistir: ' + error.message)
        
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
