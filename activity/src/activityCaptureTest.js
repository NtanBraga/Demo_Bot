
export function montarTesteCaptura(container) {
    const section = document.createElement('section')

    const title = document.createElement('h3')
    title.textContent = 'Teste de captura — Etapa 15.1'

    const status = document.createElement('pre')
    status.style.whiteSpace = 'pre-wrap'

    const startButton = document.createElement('button')
    startButton.type = 'button'
    startButton.textContent = 'Testar captura de tela'

    const stopButton = document.createElement('button')
    stopButton.type = 'button'
    stopButton.textContent = 'Parar teste'
    stopButton.disabled = true

    const preview = document.createElement('video')
    preview.autoplay = true
    preview.muted = true
    preview.playsInline = true
    preview.controls = true
    preview.style.width = '100%'
    preview.style.maxWidth = '640px'

    let stream = null

    const describeEnvironment = () => {
        const policy = document.permissionsPolicy ??
            document.featurePolicy

        const policyAllowed =
            typeof policy?.allowsFeature === 'function'
                ? policy.allowsFeature('display-capture')
                : 'Indisponível'

        return [
            `HTTPS/contexto seguro: ${window.isSecureContext}`,
            `Dentro de iframe: ${window.self !== window.top}`,
            `getDisplayMedia disponível: ${
                typeof navigator.mediaDevices?.getDisplayMedia === 'function'
            }`,
            `Permissão display-capture: ${policyAllowed}`,
            `Navegador: ${navigator.userAgent}`
        ].join('\n')
    }

    function stop() {
        const previous = stream
        stream = null

        previous?.getTracks().forEach(track => track.stop())

        preview.pause()
        preview.srcObject = null

        startButton.disabled = false
        stopButton.disabled = true
    }

    startButton.addEventListener('click', async () => {
        if (stream) return

        // A chamada ocorre diretamente após o clique do usuário.
        // Não adicionar await antes de getDisplayMedia().
        try {
            if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
                throw new Error('getDisplayMedia indisponível neste ambiente')
            }

            const captured = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false
            })

            stream = captured

            const track = stream.getVideoTracks()[0]

            track.addEventListener('ended', () => {
                stop()
                status.textContent =
                    'Captura encerrada pelo usuário.'
            }, { once: true })

            preview.srcObject = stream
            startButton.disabled = true
            stopButton.disabled = false

            status.textContent = [
                'SUCESSO: captura autorizada.',
                `Track: ${track.readyState}`,
                `Configurações: ${JSON.stringify(track.getSettings(), null, 2)}`
            ].join('\n')

            preview.play().catch(error => {
                status.textContent +=
                    `\nAviso de reprodução: ${error.message}`
            })

        } catch (error) {
            status.textContent = [
                'FALHA NA CAPTURA',
                `Nome: ${error.name}`,
                `Mensagem: ${error.message}`,
                '',
                describeEnvironment()
            ].join('\n')

            console.error('[Teste captura Activity]', error)
        }
    })

    stopButton.addEventListener('click', () => {
        stop()
        status.textContent = 'Teste encerrado.'
    })

    window.addEventListener('pagehide', stop)

    status.textContent = describeEnvironment()

    section.append(
        title,
        status,
        startButton,
        stopButton,
        preview
    )

    container.appendChild(section)
}
