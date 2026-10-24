import { SfuSession,formatSfuStats } from './sfuSession.js'

const keyInput = document.querySelector('#publisher-key');
const discordLoginButton = document.querySelector('#publisher-discord-login')
const discordStatus = document.querySelector('#publisher-discord-status')
const connectButton = document.querySelector('#connect-webrtc');
const startButton = document.querySelector('#start-webrtc');
const stopButton = document.querySelector('#stop-webrtc');
const audioCaptureStatus = document.querySelector('#audio-capture-status');
const preview = document.querySelector('#preview-webrtc');
const statusRTC = document.querySelector('#webrtc-status');
const logBox = document.querySelector('#webrtc-logs');
const sfuMonitorPanel = document.querySelector('#sfu-monitor')
const sfuMonitorStatus = document.querySelector('#sfu-monitor-status')
const sfuMonitorData = document.querySelector('#sfu-monitor-data')
const sfuMonitorDashboard = document.querySelector('#sfu-monitor-dashboard')
const sfuMonitorHistory = document.querySelector('#sfu-monitor-history')


let socket = null;
let authenticated = false;
let publisherStreamId = null
let captureStream = null;
let audioMixer = null
let capturing = false;
let switchingSource = false
let iceServers = [];

const publisherInstanceId = crypto.randomUUID()

const USE_SFU = true

let sfuSession = null
let sfuReady = false

const SFU_MONITOR_INTERVAL = 5000

const SFU_HISTORY_WINDOW_MS = 5 * 60 * 1000
const SFU_HISTORY_MAX_SAMPLES = 61

let sfuHistory = []
let sfuHistoryInstance = null

let sfuMonitorTimer = null
let sfuMonitorBusy = false
let sfuMonitorDeniedSession = null

let cachedPublisherToken = null
let pendingPublisherToken = null

let discordLoggedIn = false
let publisherAuthenticatedByDiscord = false

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

const switchSourceButton = document.querySelector('#switch-webrtc-source')

startButton.insertAdjacentElement('afterend',switchSourceButton)

sfuCodecWrapper.textContent = 'Codec de transmissão SFU: '

const sfuCodecSelect = document.createElement('select')

sfuCodecSelect.id = 'publisher-sfu-codec'

for (const codec of ['h264', 'vp8', 'av1']) {
    const option = document.createElement('option')

    option.value = codec
    option.textContent = codec.toUpperCase()

    sfuCodecSelect.appendChild(option)
}

sfuCodecSelect.value = 'av1'

sfuCodecWrapper.appendChild(sfuCodecSelect)

sfuCodecWrapper.hidden = !USE_SFU

audioCaptureStatus.insertAdjacentElement(
    'afterend',
    sfuCodecWrapper
)

const sfuQualityWrapper = document.createElement('label')

sfuQualityWrapper.textContent = 'Qualidade da transmissão: '

const sfuQualitySelect = document.createElement('select')

sfuQualitySelect.id = 'publisher-sfu-quality'

const qualityOptions = [
    ['720p30', '720p - 30 FPS'],
    ['720p60', '720p - 60 FPS'],
    ['1080p30', '1080p - 30 FPS'],
    ['1080p60', '1080p - 60 FPS'],
    ['original', 'Resolução da tela']
]

for (const [value, label] of qualityOptions) {
    const option = document.createElement('option')

    option.value = value
    option.textContent = label

    sfuQualitySelect.appendChild(option)
}

sfuQualitySelect.value = '1080p30'

sfuQualityWrapper.appendChild(sfuQualitySelect)

sfuQualityWrapper.hidden = !USE_SFU

sfuCodecWrapper.insertAdjacentElement(
    'afterend',
    sfuQualityWrapper
)

for (const wrapper of [sfuCodecWrapper, sfuQualityWrapper]) {
    wrapper.style.display = USE_SFU ? 'grid' : 'none'

    wrapper.style.gridTemplateColumns =
        'minmax(0, 1fr) minmax(140px, 45%)'

    wrapper.style.alignItems = 'center'
    wrapper.style.columnGap = '12px'

    wrapper.style.width = '100%'
    wrapper.style.maxWidth = '480px'
    wrapper.style.marginBottom = '10px'

    wrapper.querySelector('select').style.width = '100%'
}


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

function formatarPercentual(value) {
    return Number.isFinite(value)
        ? `${value.toFixed(1)}%`
        : 'Coletando...'
}

function formatarMemoria(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return 'Indisponível'
    }

    const gib = 1024 ** 3
    const mib = 1024 ** 2

    if (bytes >= gib) {
        return `${(bytes / gib).toFixed(2)} GiB`
    }

    return `${(bytes / mib).toFixed(1)} MiB`
}


function criarCartaoSFU(label, value, percent = null, detail = '') {
    const card = document.createElement('article')
    card.className = 'sfu-monitor-card'

    const title = document.createElement('span')
    title.className = 'sfu-monitor-card__label'
    title.textContent = label

    const number = document.createElement('strong')
    number.className = 'sfu-monitor-card__value'
    number.textContent = value

    card.append(title, number)

    if (Number.isFinite(percent)) {
        const track = document.createElement('div')
        track.className = 'sfu-monitor-track'

        const fill = document.createElement('div')
        fill.className = 'sfu-monitor-fill'

        const safePercent = Math.max(
            0,
            Math.min(100, percent)
        )

        fill.style.width = `${safePercent}%`

        track.appendChild(fill)
        card.appendChild(track)
    }

    if (detail) {
        const description = document.createElement('small')
        description.className = 'sfu-monitor-card__detail'
        description.textContent = detail

        card.appendChild(description)
    }

    return card
}

function criarGrupoSFU(title, cards) {
    const section = document.createElement('section')
    section.className = 'sfu-monitor-group'

    const heading = document.createElement('h3')
    heading.textContent = title

    const grid = document.createElement('div')
    grid.className = 'sfu-monitor-grid'

    grid.append(...cards)
    section.append(heading, grid)

    return section
}


function criarHistoricoEventosSFU(events) {
    const section = document.createElement('section')
    section.className = 'sfu-monitor-group'

    const heading = document.createElement('h3')
    heading.textContent = 'Eventos recentes do SFU'

    const list = document.createElement('ul')
    list.className = 'sfu-events-list'

    const items = Array.isArray(events) ? events : []

    if (items.length === 0) {
        const empty = document.createElement('li')
        empty.textContent = 'Nenhum evento registrado.'
        list.appendChild(empty)
    }

    for (const event of items) {
        const item = document.createElement('li')

        const level = ['info', 'warning', 'error']
            .includes(event.level)
            ? event.level
            : 'info'

        item.dataset.level = level

        const time = new Date(event.timestamp)
            .toLocaleTimeString('pt-BR')

        item.textContent = `${time} — ${event.message}`

        list.appendChild(item)
    }

    section.append(heading, list)

    return section
}


function renderizarDashboardSFU(stats) {
    const vm = stats.vm ?? {}
    const memory = vm.memory ?? {}
    const node = stats.node ?? {}
    const connections = stats.connections ?? {}

    const workers = Array.isArray(stats.workers)
        ? stats.workers
        : []

    const vmCards = [
        criarCartaoSFU(
            'CPU da VM',
            formatarPercentual(vm.cpuPercent),
            vm.cpuPercent,
            `${vm.cpuCount ?? '—'} vCPUs`
        ),

        criarCartaoSFU(
            'RAM da VM',
            formatarPercentual(memory.usagePercent),
            memory.usagePercent,
            `${formatarMemoria(memory.usedBytes)} / ` +
            formatarMemoria(memory.totalBytes)
        )
    ]

    const nodeCards = [
        criarCartaoSFU(
            'CPU Node.js',
            formatarPercentual(node.cpuPercent),
            node.cpuPercent,
            `PID ${node.pid ?? '—'}`
        ),

        criarCartaoSFU(
            'RAM Node.js',
            formatarMemoria(node.rssBytes)
        )
    ]

    const workerCards = workers.map((worker, index) =>
        criarCartaoSFU(
            `Worker ${worker.index != null ? worker.index + 1 : index + 1} — PID ${worker.pid}`,
            formatarPercentual(worker.cpuPercent),
            worker.cpuPercent,
            `UDP ${worker.udpPort ?? '—'} · ` +
            `RAM: ${formatarMemoria(worker.rssBytes)} · ` +
            `Salas: ${worker.rooms ?? 0}`
        )
    )

    if (workerCards.length === 0) {
        workerCards.push(
            criarCartaoSFU('Workers', 'Nenhum ativo')
        )
    }

    const connectionCards = [
        criarCartaoSFU('Salas', String(connections.rooms ?? 0)),
        criarCartaoSFU('Transmissores', String(connections.publishers ?? 0)),
        criarCartaoSFU('Espectadores', String(connections.viewers ?? 0)),
        criarCartaoSFU('Transports', String(connections.transports ?? 0)),
        criarCartaoSFU('Producers', String(connections.producers ?? 0)),
        criarCartaoSFU('Consumers', String(connections.consumers ?? 0))
    ]

    sfuMonitorDashboard.replaceChildren(
        criarGrupoSFU('Máquina virtual Azure', vmCards),
        criarGrupoSFU('Processo Node.js', nodeCards),
        criarGrupoSFU(
            `Workers mediasoup (${stats.workerCount ?? workers.length})`,
            workerCards
        ),
        criarGrupoSFU('Conexões WebRTC', connectionCards),
        criarHistoricoEventosSFU(stats.events)
    )

    sfuMonitorData.hidden = true
    sfuMonitorDashboard.hidden = false
}


function registrarHistoricoSFU(stats) {
    const workers = Array.isArray(stats.workers)
        ? stats.workers
        : []

    const instance = [
        stats.node?.pid,
        ...workers.map(worker => worker.pid)
    ].join(':')

    if (
        sfuHistoryInstance !== null &&
        sfuHistoryInstance !== instance
    ) {
        sfuHistory = []
    }

    sfuHistoryInstance = instance

    const workerCpuValues = workers
        .map(worker => worker.cpuPercent)
        .filter(Number.isFinite)

    const workerMemoryValues = workers
        .map(worker => worker.rssBytes)
        .filter(Number.isFinite)

    const workerCpu = workerCpuValues.length
        ? workerCpuValues.reduce((sum, value) => sum + value, 0)
        : null

    const workerMemory = workerMemoryValues.length
        ? workerMemoryValues.reduce((sum, value) => sum + value, 0)
        : null

    const toMiB = bytes =>
        Number.isFinite(bytes)
            ? bytes / (1024 ** 2)
            : null

    sfuHistory.push({
        time: Date.now(),

        vmCpu: stats.vm?.cpuPercent ?? null,
        vmMemory: stats.vm?.memory?.usagePercent ?? null,

        nodeCpu: stats.node?.cpuPercent ?? null,
        workerCpu,

        nodeMemory: toMiB(stats.node?.rssBytes),
        workerMemory: toMiB(workerMemory)
    })

    const cutoff = Date.now() - SFU_HISTORY_WINDOW_MS

    sfuHistory = sfuHistory.filter(sample =>
        sample.time >= cutoff
    )

    if (sfuHistory.length > SFU_HISTORY_MAX_SAMPLES) {
        sfuHistory = sfuHistory.slice(
            -SFU_HISTORY_MAX_SAMPLES
        )
    }
}


function desenharGraficoSFU(canvasId, series, maxY, unit = '') {
    const canvas = document.getElementById(canvasId)
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = Math.max(
        250,
        Math.round(canvas.getBoundingClientRect().width)
    )

    const height = 180
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const left = 44
    const right = 12
    const top = 12
    const bottom = 24

    const graphWidth = width - left - right
    const graphHeight = height - top - bottom

    ctx.font = '11px sans-serif'
    ctx.lineWidth = 1

    for (let i = 0; i <= 4; i++) {
        const y = top + (graphHeight / 4) * i
        const value = maxY * (1 - i / 4)

        ctx.strokeStyle = 'rgba(255,255,255,0.12)'
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(width - right, y)
        ctx.stroke()

        ctx.fillStyle = '#9ca3af'
        ctx.fillText(
            `${Math.round(value)}${unit}`,
            2,
            y + 4
        )
    }

    const latestTime = sfuHistory.at(-1)?.time ?? Date.now()
    const startTime = latestTime - SFU_HISTORY_WINDOW_MS

    ctx.fillStyle = '#9ca3af'
    ctx.fillText('-5 min', left, height - 5)
    ctx.fillText('Agora', width - 45, height - 5)

    for (const serie of series) {
        ctx.beginPath()

        let drawing = false
        let lastPoint = null

        for (const sample of sfuHistory) {
            const value = sample[serie.key]

            if (!Number.isFinite(value)) {
                drawing = false
                continue
            }

            const x = left +
                ((sample.time - startTime) / SFU_HISTORY_WINDOW_MS) *
                graphWidth

            const y = top +
                (1 - Math.max(0, Math.min(value, maxY)) / maxY) *
                graphHeight

            if (!drawing) {
                ctx.moveTo(x, y)
                drawing = true
            } else {
                ctx.lineTo(x, y)
            }

            lastPoint = { x, y }
        }

        ctx.strokeStyle = serie.color
        ctx.lineWidth = 2
        ctx.stroke()

        if (lastPoint) {
            ctx.beginPath()
            ctx.arc(lastPoint.x, lastPoint.y, 3, 0, Math.PI * 2)
            ctx.fillStyle = serie.color
            ctx.fill()
        }
    }
}

function renderizarGraficosSFU() {
    if (sfuHistory.length === 0) return

    const maxHistorico = (...keys) =>
        Math.max(
            0,
            ...sfuHistory.flatMap(sample =>
                keys.map(key =>
                    Number.isFinite(sample[key])
                        ? sample[key]
                        : 0
                )
            )
        )

    const maxProcessCpu = Math.max(
        100,
        Math.ceil(maxHistorico('nodeCpu', 'workerCpu') / 25) * 25
    )

    const maxProcessMemory = Math.max(
        64,
        Math.ceil(
            maxHistorico('nodeMemory', 'workerMemory') * 1.15 / 64
        ) * 64
    )

    desenharGraficoSFU(
        'sfu-chart-vm-cpu',
        [{ key: 'vmCpu', color: '#5865f2' }],
        100,
        '%'
    )

    desenharGraficoSFU(
        'sfu-chart-vm-memory',
        [{ key: 'vmMemory', color: '#5865f2' }],
        100,
        '%'
    )

    desenharGraficoSFU(
        'sfu-chart-process-cpu',
        [
            { key: 'nodeCpu', color: '#60a5fa' },
            { key: 'workerCpu', color: '#4ade80' }
        ],
        maxProcessCpu,
        '%'
    )

    desenharGraficoSFU(
        'sfu-chart-process-memory',
        [
            { key: 'nodeMemory', color: '#60a5fa' },
            { key: 'workerMemory', color: '#4ade80' }
        ],
        maxProcessMemory,
        'M'
    )
}

async function atualizarMonitorSFU() {
    if (
        !sfuMonitorPanel.open ||
        closingPage ||
        sfuMonitorBusy
    ) return

    const session = sfuSession

    if (!sfuReady || !session || session.closed) {

        sfuMonitorDashboard.hidden = true
        sfuMonitorData.hidden = false

        sfuMonitorHistory.hidden = true

        sfuMonitorStatus.textContent = 'Aguardando conexão com o SFU...'

        sfuMonitorData.textContent = 'Conecte a sinalização para consultar a Azure.'

        return
    }

    if (sfuMonitorDeniedSession === session) return

    sfuMonitorBusy = true

    try {
        const stats = await session.request('monitor:stats')

        if (
            session !== sfuSession ||
            !sfuMonitorPanel.open ||
            closingPage
        ) return

        const vm = stats.vm ?? {}
        const memory = vm.memory ?? {}
        const connections = stats.connections ?? {}
        const node = stats.node ?? {}
        const workers = Array.isArray(stats.workers)
            ? stats.workers
            : []

        const workerLines = workers.flatMap((worker, index) => [
            `Worker ${index + 1} — PID ${worker.pid}`,
            `  CPU: ${formatarPercentual(worker.cpuPercent)}`,
            `  RAM: ${formatarMemoria(worker.rssBytes)}`,
            `  Salas: ${worker.rooms ?? 0}`,
            ''
        ])

        sfuMonitorStatus.textContent =
            'Monitoramento ativo — Azure conectada'

        sfuMonitorData.textContent = [
            `Atualizado: ${new Date(stats.timestamp).toLocaleTimeString('pt-BR')}`,
            '',
            '=== VM AZURE ===',
            `CPU: ${formatarPercentual(vm.cpuPercent)}`,
            `vCPUs: ${vm.cpuCount ?? '—'}`,
            `RAM: ${formatarMemoria(memory.usedBytes)} / ${formatarMemoria(memory.totalBytes)}`,
            `Uso de RAM: ${formatarPercentual(memory.usagePercent)}`,
            '',
            `=== WORKERS MEDIASOUP (${stats.workerCount ?? workers.length}) ===`,
            ...(workerLines.length
                ? workerLines
                : ['Nenhum Worker ativo', '']),
            '=== NODE.JS ===',
            `PID: ${node.pid ?? '—'}`,
            `CPU: ${formatarPercentual(node.cpuPercent)}`,
            `RAM: ${formatarMemoria(node.rssBytes)}`,
            `Uptime: ${node.uptimeSeconds ?? 0}s`,
            '',
            '=== CONEXÕES ===',
            `Salas: ${connections.rooms ?? 0}`,
            `Transmissores: ${connections.publishers ?? 0}`,
            `Espectadores: ${connections.viewers ?? 0}`,
            `Transports: ${connections.transports ?? 0}`,
            `Producers: ${connections.producers ?? 0}`,
            `Consumers: ${connections.consumers ?? 0}`
        ].join('\n')

        renderizarDashboardSFU(stats)

        registrarHistoricoSFU(stats)

        sfuMonitorHistory.hidden = false

        renderizarGraficosSFU()

    } catch (error) {
        if (
            session !== sfuSession ||
            !sfuMonitorPanel.open ||
            closingPage
        ) return

        if (/sem permiss[aã]o/i.test(error.message)) {
            sfuMonitorDeniedSession = session

            sfuMonitorDashboard.hidden = true
            sfuMonitorData.hidden = false

            sfuMonitorStatus.textContent = 'Acesso ao monitoramento não autorizado.'

            sfuMonitorData.textContent = 'Verifique SFU_MONITOR_ADMIN_IDS na Azure.'

        } else {
            sfuMonitorStatus.textContent = `Erro ao consultar SFU: ${error.message}`
        }

    } finally {
        sfuMonitorBusy = false
    }
}

function iniciarMonitorSFU() {
    if (sfuMonitorTimer !== null) return

    void atualizarMonitorSFU()

    sfuMonitorTimer = setInterval(() => {
        void atualizarMonitorSFU()
    }, SFU_MONITOR_INTERVAL)
}

function pararMonitorSFU() {
    if (sfuMonitorTimer === null) return

    clearInterval(sfuMonitorTimer)
    sfuMonitorTimer = null
}

sfuMonitorPanel.addEventListener('toggle', () => {
    if (sfuMonitorPanel.open) {
        iniciarMonitorSFU()
    } else {
        pararMonitorSFU()
    }
})


const QUALITY_CAPTURE_PRESETS = {
    '720p30': {
        width: 1280,
        height: 720,
        fps: 30
    },

    '720p60': {
        width: 1280,
        height: 720,
        fps: 60
    },

    '1080p30': {
        width: 1920,
        height: 1080,
        fps: 30
    },

    '1080p60': {
        width: 1920,
        height: 1080,
        fps: 60
    }
}

const QUALITY_MAX_BITRATE = {
    '720p30': 4_000_000,
    '720p60': 6_000_000,
    '1080p30': 8_000_000,
    '1080p60': 12_000_000,
    'original': 20_000_000
}

function getSelectedMaxBitrate() {
    return QUALITY_MAX_BITRATE[sfuQualitySelect.value]
        ?? 8_000_000
}

function getCaptureOptions() {
    const selectedQuality = sfuQualitySelect.value

    const preset = QUALITY_CAPTURE_PRESETS[selectedQuality]

    const fps = preset?.fps ?? 60

    const video = {
        frameRate: {
            ideal: fps,
            max: fps
        }
    }

    if (preset) {
        video.width = {
            ideal: preset.width,
            max: preset.width
        }

        video.height = {
            ideal: preset.height,
            max: preset.height
        }
    }

    return {
        video,
        audio: true,
        systemAudio: 'include',
        windowAudio: 'window'
    }
}

function createAudioMixer() {
    const AudioContextClass =
        window.AudioContext || window.webkitAudioContext

    if (!AudioContextClass) {
        throw new Error('Web Audio API indisponível.')
    }

    const context = new AudioContextClass()
    const destination = context.createMediaStreamDestination()

    const silence = context.createConstantSource()
    const silenceGain = context.createGain()

    silenceGain.gain.value = 0

    silence.connect(silenceGain)
    silenceGain.connect(destination)
    silence.start()

    context.resume().catch(error => {
        log('Não foi possível ativar o mixer: ' + error.message)
    })

    return {
        context,
        destination,
        silence,
        silenceGain,
        inputNode: null,
        inputTrack: null
    }
}

function prepareAudioInput(mixer, stream) {
    const track = stream.getAudioTracks().find(
        item => item.readyState === 'live'
    ) ?? null

    const node = track
        ? mixer.context.createMediaStreamSource(
            new MediaStream([track])
        )
        : null

    return { track, node }
}

function applyAudioInput(mixer, input) {
    const previousNode = mixer.inputNode

    previousNode?.disconnect()

    try {
        input.node?.connect(mixer.destination)
    } catch (error) {
        previousNode?.connect(mixer.destination)
        throw error
    }

    mixer.inputNode = input.node
    mixer.inputTrack = input.track

    if (input.track) {
        audioCaptureStatus.textContent =
            'Áudio: fonte disponibilizada pelo navegador.'

        log('Mixer: nova entrada de áudio conectada.')

        input.track.addEventListener('ended', () => {
            if (
                audioMixer === mixer &&
                mixer.inputTrack === input.track
            ) {
                audioCaptureStatus.textContent =
                    'Áudio: fonte encerrada; enviando silêncio.'
            }
        }, { once: true })
    } else {
        audioCaptureStatus.textContent =
            'Áudio: fonte sem áudio; enviando silêncio.'

        log('Mixer: sem áudio na fonte atual.')
    }
}

function closeAudioMixer(mixer) {
    if (!mixer) return

    mixer.inputNode?.disconnect()
    mixer.silence.stop()
    mixer.silence.disconnect()
    mixer.silenceGain.disconnect()

    for (const track of mixer.destination.stream.getTracks()) {
        track.stop()
    }

    mixer.context.close().catch(error => {
        console.warn('[AudioMixer] Falha ao fechar:', error)
    })
}

function getPublicationStream(stream) {
    const videoTrack = stream.getVideoTracks()[0]
    const audioTrack =
        audioMixer?.destination.stream.getAudioTracks()[0]

    if (
        !videoTrack ||
        videoTrack.readyState !== 'live' ||
        !audioTrack ||
        audioTrack.readyState !== 'live'
    ) {
        throw new Error('Tracks de publicação indisponíveis.')
    }

    return new MediaStream([videoTrack, audioTrack])
}


async function verificarLoginDiscord() {
    try {
        const response = await fetch('/api/publisher/me', {
            credentials: 'same-origin',
            cache: 'no-store'
        })

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json()

        if (data.authenticated && data.user) {
            discordLoggedIn = true

            const name = data.user.global_name || data.user.username

            discordStatus.textContent = `Discord autenticado: ${name}`

            discordLoginButton.hidden = true

            log('Identidade Discord do publisher verificada.')
        } else {
            discordStatus.textContent = 'Discord: não autenticado.'
            discordLoggedIn = false
            discordLoginButton.hidden = false
        }

    } catch (error) {
        discordStatus.textContent = 'Não foi possível verificar o login Discord.'

        console.error('[Publisher OAuth] Falha:', error.message)
    }
}

discordLoginButton.addEventListener('click', () => {
    window.location.assign('/api/publisher/login')
})

void verificarLoginDiscord()


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
    switchSourceButton.disabled = !authenticated || !USE_SFU || !sfuReady || !captureStream || capturing || switchingSource

    sfuCodecSelect.disabled = !sfuReady || captureStream !== null || capturing
    sfuQualitySelect.disabled = !sfuReady || captureStream !== null || capturing

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
        (!cachedPublisherToken && !publisherAuthenticatedByDiscord) ||
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
    const previousMixer = audioMixer

    captureStream = null
    audioMixer = null

    let stopPromise = Promise.resolve()

    if (USE_SFU && sfuSession) {
        sfuSession.stopStats()
        sfuStatsBox.textContent = 'Transmissão parada.'

        stopPromise = sfuSession.stopPublishing().catch(error => {
            log('Falha ao parar SFU: ' + error.message)
        })
    }

    if (previousMixer) {
        void stopPromise.finally(() => {
            closeAudioMixer(previousMixer)
        })
    }

    audioCaptureStatus.textContent = 'Áudio: aguardando compartilhamento.'


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
        case 'publisher:remote-stop': {
            if (!authenticated || !captureStream || message.streamId !== publisherStreamId) break
            
            log('Parada solicitada pela Discord Activity.')

            stopCapture()

            break
        }
        case 'publisher:ready':
            authenticated = true
            publisherStreamId = message.streamId

            publisherAuthenticatedByDiscord =
                message.authMethod === 'discord'

            cachedPublisherToken = publisherAuthenticatedByDiscord
                ? null
                : pendingPublisherToken

            pendingPublisherToken = null

            log(
                'Método de autenticação: ' +
                (publisherAuthenticatedByDiscord
                    ? 'Discord OAuth2'
                    : 'Chave de transmissor')
            )

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

                    await session.publish(getPublicationStream(streamToRestore),sfuCodecSelect.value,getSelectedMaxBitrate())

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
            if (
                !authenticated &&
                (
                    message.message?.includes('Publicação não autorizada') ||
                    message.message?.includes('Você já possui uma transmissão ativa')
                )
            ) {
                publisherAuthenticatedByDiscord = false
                cachedPublisherToken = null
                pendingPublisherToken = null
            }

            log(`Servidor: ${message.message || 'Erro desconhecido.'}`)
            statusRTC.textContent = 'Erro de sinalização.'
            break
        default:
            log(`Mensagem não reconhecida: ${message.type}.`)
    }
}

function connect(){
    if(socket) return

    let token = keyInput.value.trim() || cachedPublisherToken || ''

    if (!token && !discordLoggedIn && !publisherAuthenticatedByDiscord) {
        statusRTC.textContent = 'Entre com Discord ou informe a chave de transmissor.'
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
            instanceId: publisherInstanceId,
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
        publisherStreamId = null

        viewers.clear()
        viewerCodecPreferences.clear()

        const oldSession = sfuSession

        sfuSession = null
        sfuReady = false

        oldSession?.close()
        clearSfuGrantPending()

        clearTimeout(sfuRetryTimer)
        sfuRetryTimer = null

        if (!USE_SFU || closingPage || (!cachedPublisherToken && !publisherAuthenticatedByDiscord)) {
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

    let provisionalMixer = null

    try{

        if (USE_SFU) {
            provisionalMixer = createAudioMixer()
        }

        const stream = await navigator.mediaDevices.getDisplayMedia(
            getCaptureOptions()
        )

        if(!authenticated){
            stream.getTracks().forEach(track => track.stop())
            return
        }

        captureStream = stream

        if (USE_SFU) {
            audioMixer = provisionalMixer
            provisionalMixer = null

            applyAudioInput(
                audioMixer,
                prepareAudioInput(audioMixer, stream)
            )
        } else {
            audioCaptureStatus.textContent =
                stream.getAudioTracks().length > 0
                    ? 'Áudio: capturado.'
                    : 'Áudio: indisponível.'
        }


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

        log(
            `Qualidade selecionada: ${sfuQualitySelect.value}, ` +
            `captura: ${settings.width}x${settings.height}, ` +
            `FPS configurado: ${settings.frameRate ?? 'n/d'}, ` +
            `áudio: ${audioTracks.length ? 'sim' : 'não'}.`
        )

        if (audioTracks.length === 0) {
            log('O navegador não forneceu áudio. O mixer enviará silêncio.')
        }

        if (USE_SFU) {
            const session = sfuSession

            if (!sfuReady || !session) {
                throw new Error('SFU ainda nao conectado')
            }

            await session.publish(getPublicationStream(stream),sfuCodecSelect.value,getSelectedMaxBitrate())

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
         if (e.name === 'NotReadableError' && /audio source/i.test(e.message)) {
            log(
                'Não foi possível iniciar o áudio do sistema. ' +
                'Tente compartilhar a tela sem áudio ou verificar ' +
                'o dispositivo de reprodução do Windows.'
            )

            statusRTC.textContent = 'Falha ao capturar áudio do sistema. Tente novamente sem áudio.'
        } else {
            log(`Erro na captura: ${e.name || 'Error'} - ${e.message}`)
        }

        stopCapture()
    }finally{
        if (provisionalMixer) closeAudioMixer(provisionalMixer)
        capturing = false
        updateButtons()
    }
}


async function switchCaptureSource() {
    if (
        !USE_SFU ||
        !authenticated ||
        !sfuReady ||
        !captureStream ||
        !sfuSession ||
        !audioMixer ||
        capturing ||
        switchingSource
    ) return

    const previousStream = captureStream
    const session = sfuSession
    const mixer = audioMixer

    let nextStream = null

    switchingSource = true
    updateButtons()

    statusRTC.textContent = 'Escolhendo uma nova fonte...'

    try {
        nextStream = await navigator.mediaDevices.getDisplayMedia(
            getCaptureOptions()
        )

        const nextVideoTrack = nextStream.getVideoTracks()[0]

        if (
            !nextVideoTrack ||
            nextVideoTrack.readyState !== 'live'
        ) {
            throw new Error('Nova fonte sem vídeo válido.')
        }

        if (
            captureStream !== previousStream ||
            sfuSession !== session ||
            audioMixer !== mixer ||
            session.closed ||
            !authenticated ||
            !sfuReady
        ) {
            log('Troca cancelada: a sessão mudou.')
            return
        }

        const nextAudioInput = prepareAudioInput(
            mixer,
            nextStream
        )

        const previousVideoTrack =
            previousStream.getVideoTracks()[0]

        const previousVideoProducerId =
            session.producers.get('video')?.id

        const previousAudioProducerId =
            session.producers.get('audio')?.id

        const videoProducerId = await session.replaceVideoTrack(
            nextVideoTrack
        )

        if (
            captureStream !== previousStream ||
            sfuSession !== session ||
            audioMixer !== mixer ||
            session.closed ||
            !authenticated ||
            !sfuReady
        ) {
            log('A sessão mudou durante a substituição.')
            return
        }

        try {
            applyAudioInput(mixer, nextAudioInput)
        } catch (error) {
            if (
                previousVideoTrack?.readyState === 'live' &&
                !session.closed
            ) {
                await session.replaceVideoTrack(
                    previousVideoTrack
                ).catch(rollbackError => {
                    log(
                        'Falha ao restaurar vídeo: ' +
                        rollbackError.message
                    )
                })
            }

            throw error
        }

        captureStream = nextStream
        nextStream = null

        const activeStream = captureStream

        preview.srcObject = activeStream

        preview.play().catch(error => {
            log('Prévia: ' + error.message)
        })

        nextVideoTrack.addEventListener('ended', () => {
            if (captureStream !== activeStream) return

            log('Nova fonte encerrada pelo navegador.')
            stopCapture()
        }, { once: true })

        for (const track of previousStream.getTracks()) {
            track.stop()
        }

        const currentAudioProducerId =
            session.producers.get('audio')?.id

        log('Fonte de captura alterada com sucesso.')

        log(
            'Producer de vídeo preservado: ' +
            (previousVideoProducerId === videoProducerId)
        )

        log(
            'Producer de áudio preservado: ' +
            (previousAudioProducerId === currentAudioProducerId)
        )

        const settings = nextVideoTrack.getSettings()

        log(
            'Resolução atual: ' +
            `${settings.width ?? '?'}x${settings.height ?? '?'}`
        )

        statusRTC.textContent =
            'Fonte alterada. Transmissão permanece ao vivo.'

    } catch (error) {
        if (error.name === 'NotReadableError' && /audio source/i.test(error.message)) {
            log(
                'Não foi possível capturar o áudio da nova fonte. ' +
                'A transmissão anterior foi mantida.'
            )
        }
        if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
            log('Seleção da nova fonte cancelada.')
        } else {
            log(
                'Erro ao trocar fonte: ' +
                `${error.name || 'Error'} - ${error.message}`
            )
        }

        if (captureStream === previousStream) {
            statusRTC.textContent = 'Fonte anterior mantida.'
        }

    } finally {
        if (nextStream) {
            for (const track of nextStream.getTracks()) {
                track.stop()
            }
        }

        switchingSource = false
        updateButtons()
    }
}

window.addEventListener('resize', () => {
    if (
        sfuMonitorPanel.open &&
        !sfuMonitorHistory.hidden
    ) {
        renderizarGraficosSFU()
    }
})

connectButton.addEventListener('click', connect)
startButton.addEventListener('click', startCapture)
stopButton.addEventListener('click', () => {
    log('Captura encerrada manualmente.')
    stopCapture()
})
switchSourceButton.addEventListener('click',switchCaptureSource)

window.addEventListener('pagehide', () => {
    closingPage = true

    pararMonitorSFU()

    clearTimeout(sfuRetryTimer)
    clearTimeout(relayRetryTimer)
    clearTimeout(sfuGrantTimeout)

    cachedPublisherToken = null
    stopCapture()
    sfuSession?.close()
    socket?.close(1000, 'Pagina encerrada.')
})
updateButtons()