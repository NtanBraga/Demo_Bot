export function montarPlayerMSE(container, clientId) {
    const section = document.createElement("section");

    section.innerHTML = `
        <hr>

        <h3>Transmissão ao vivo</h3>

        <p id="mse-status">
            Informe a chave de visualização.
        </p>

        <p id="mse-viewers">
            Espectadores conectados: 0
        </p>
        <p id="mse-health">
            Aguardando informações de desempenho...
        </p>

        <input
            id="mse-key"
            type="password"
            placeholder="Chave para assistir"
            autocomplete="off"
        >

        <button id="mse-connect">
            Assistir via MSE
        </button>

        <button id="mse-disconnect" disabled>
            Desconectar
        </button>

        <button id="mse-sound" disabled>
            Ativar som
        </button>

        <video
            id="mse-video"
            controls
            autoplay
            muted
            playsinline
            style="
                display:block;
                width:100%;
                max-width:960px;
                background:black;
                margin-top:12px;
            "
        ></video>

        <pre
            id="mse-logs"
            style="
                white-space:pre-wrap;
                max-height:160px;
                overflow:auto;
            "
        ></pre>
    `;

    container.appendChild(section);

    const status = section.querySelector("#mse-status");
    const keyInput = section.querySelector("#mse-key");
    const viewersLabel = section.querySelector("#mse-viewers")
    const connectButton = section.querySelector("#mse-connect");
    const disconnectButton = section.querySelector("#mse-disconnect");
    const video = section.querySelector("#mse-video");
    const logs = section.querySelector("#mse-logs");
    const health = section.querySelector("#mse-health")
    const soundButton = section.querySelector("#mse-sound")

    let somAtivado = false

    let socket = null;
    let mediaSource = null;
    let sourceBuffer = null;
    let objectUrl = null;

    let started = false;
    let segments = 0;
    let queuedBytes = 0;
    let pausadoPorOcultacao = false


    let codecAtivo = null
    let inicioCodecEm = 0
    let ultimoSeekEm = 0
    let qualidadeAnterior = null
    let posicaoAnterior = null

    let ultimaMedicaoFPS = 0
    let fpsEfetivo = null

    let amostraBufferAnterior = null
    let ultimoLogDiagnostico = 0

    let amostrasComQuedas = 0
    let amostrasTravadas = 0
    let fallbackDesempenhoSolicitado = false
    let alertaRedeEm = 0
    let bytesPendentesNoRelay = 0

    const queue = [];

    function log(message) {
        console.log("[Activity MSE]", message);

        logs.textContent += `${message}\n`;

        if (logs.textContent.length > 4000) {
            logs.textContent = logs.textContent.slice(-3000);
        }
    }

    const eventosDiagnostico = [
        "waiting",
        "stalled",
        "playing",
        "pause",
        "seeking",
        "seeked"
    ]

    for(const evento of eventosDiagnostico){
        video.addEventListener(evento, () => {
            const buffered = video.buffered
            const faixas = []

            if(buffered){
                for(let i = 0; i < buffered.length; i++){
                    faixas.push({
                        inicio: buffered.start(i),
                        fim: buffered.end(i)
                    })
                }
            }


            const posicao = video.currentTime

            const faixaAtual = faixas.find(faixa => posicao >= faixa.inicio && posicao <= faixa.fim)

           
            console.log(`[Playback] ${evento}`, {
                posicao: posicao.toFixed(3),
                readyState: video.readyState,
                paused: video.paused,
                seeking: video.seeking,
                documentHidden: document.hidden,
                restanteNaFaixa: faixaAtual
                    ? (faixaAtual.fim - posicao).toFixed(3)
                    : null,
                faixas
            })
        })
    }

    function limparMidia() {
        video.pause();
        video.removeAttribute("src");
        video.load();

        pausadoPorOcultacao = false

        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
        }

        objectUrl = null;
        mediaSource = null;
        sourceBuffer = null;

        ultimaMedicaoFPS = 0
        fpsEfetivo = null

        amostraBufferAnterior = null

        soundButton.disabled = true

        queue.length = 0;
        queuedBytes = 0;
        started = false;
        segments = 0;

        codecAtivo = null
        inicioCodecEm = 0
        ultimoSeekEm = 0
        qualidadeAnterior = null
        posicaoAnterior = null
        amostrasComQuedas = 0
        amostrasTravadas = 0
        fallbackDesempenhoSolicitado = false

        alertaRedeEm = 0
        bytesPendentesNoRelay = 0

        health.textContent = "Aguardando dados de desempenho..."
    }

    function desconectar() {
        const oldSocket = socket;
        socket = null;

        if (oldSocket &&
            oldSocket.readyState <= WebSocket.OPEN) {
            oldSocket.close(1000, "Espectador saiu");
        }

        limparMidia();

        connectButton.disabled = false;
        disconnectButton.disabled = true;

        viewersLabel.textContent = "Espectadores conectados: 0"
        status.textContent = "Desconectado.";
    }

    function acompanharBuffer() {
        if (!video.buffered.length || video.seeking || document.hidden) return;

        const start = video.buffered.start(0);

        const end = video.buffered.end(
            video.buffered.length - 1
        );

        if (!started && end - start >= 2) {
            started = true;

            video.currentTime = Math.max(start,end - 2);

            ultimoSeekEm = performance.now()

            video.play().then(() => {
                status.textContent = "Reproduzindo via MSE.";
            }).catch(error => {
                status.textContent = "Clique em Play para iniciar.";
                log(`Autoplay: ${error.message}`);
                });

        } else if (started && !video.paused && !video.seeking && end - video.currentTime > 7 && performance.now() - ultimoSeekEm > 3000) {
            const atrasoAnterior = end - video.currentTime

            video.currentTime = Math.max(start,end - 2);

            ultimoSeekEm = performance.now()

            log(`Atraso ajustado: ${atrasoAnterior.toFixed(2)}s`);
        }
    }

    function anexarProximo() {
        if (
            !sourceBuffer ||
            sourceBuffer.updating ||
            mediaSource?.readyState !== "open" ||
            queue.length === 0
        ) {
            return;
        }

        const chunk = queue.shift();

        queuedBytes -= chunk.byteLength;

        try {
            sourceBuffer.appendBuffer(chunk);

        } catch (error) {
            log(`Erro appendBuffer: ${error.message}`);

            desconectar();

            status.textContent =
                "Falha ao adicionar segmento WebM.";
        }
    }

    function monitorarReproducao(){
        if(!socket || !mediaSource || !codecAtivo) return

        const agora = performance.now()

        const atrasoBuffer = video.buffered.length
            ? Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime)
            : null
            
        const filaMSE = queuedBytes / (1024 * 1024)
        const qualidade = video.getVideoPlaybackQuality?.()

        let taxaQuedas = null

        if(qualidade) {
            const atual = {
                total: qualidade.totalVideoFrames,
                descartados: qualidade.droppedVideoFrames
            }

            if(qualidadeAnterior){
                const totalNovos = atual.total - qualidadeAnterior.total
                const descartadosNovos = atual.descartados - qualidadeAnterior.descartados

                if(totalNovos >= 30 && descartadosNovos >= 0 && descartadosNovos <= totalNovos){
                    taxaQuedas = descartadosNovos / totalNovos
                }

                const segundos = (agora - ultimaMedicaoFPS) / 1000
                if(segundos > 0 ){
                    fpsEfetivo = Math.max(0, (totalNovos - descartadosNovos) / segundos)
                }
            }

            qualidadeAnterior = atual

            ultimaMedicaoFPS = agora

        }
        const reproduzindo = started && !video.paused && !video.seeking && !document.hidden

        const janelaValida = reproduzindo && agora - inicioCodecEm >= 20_000 && agora - ultimoSeekEm >= 10_000
        const muitasQuedas = janelaValida && taxaQuedas !== null && taxaQuedas >= 0.20
        const travamento = 
            janelaValida &&
            atrasoBuffer !== null &&
            atrasoBuffer >= 2 &&
            video.readyState >= 2 &&
            posicaoAnterior !== null &&
            Math.abs(video.currentTime - posicaoAnterior) < 0.15
        
        amostrasComQuedas = muitasQuedas ? amostrasComQuedas + 1 : 0
        amostrasTravadas = travamento ? amostrasTravadas + 1 : 0
        
        posicaoAnterior = video.currentTime

        const quedaTexto = taxaQuedas === null
            ? "n/d"
            : `${(taxaQuedas * 100).toFixed(1)}%`

        const atrasoTexto = atrasoBuffer === null
            ? "n/d"
            : `${atrasoBuffer.toFixed(1)}s`

        const redeEmAlerta = agora - alertaRedeEm < 15_000
        const redeTexto = redeEmAlerta 
            ? `Congestionada (${(bytesPendentesNoRelay / 1048576).toFixed(1)} MiB)`
            : "Sem alerta"

        health.textContent = 
            `Codec: ${codecAtivo.includes("av01") ? "AV1" : "VP8"} | ` +
            `Quadros descartados: ${quedaTexto} | ` +
            `Atraso no buffer: ${atrasoTexto} | ` +
            `Fila MSE: ${filaMSE.toFixed(2)} MiB | ` +
            `Rede: ${redeTexto} | ` +
            `FPS exibidos: ${fpsEfetivo?.toFixed(1) ?? "n/d"} |`
        
        if(codecAtivo.includes("av01") && !fallbackDesempenhoSolicitado && (amostrasComQuedas >= 3 || amostrasTravadas >= 3)){
            const reason = amostrasComQuedas >= 3 ? "dropped-frames" : "decoder-stall"

            fallbackDesempenhoSolicitado = true

            log(`Desempenho ruim persistente: ${reason}`)

            if(socket.readyState === WebSocket.OPEN){
                socket.send(JSON.stringify({
                    type: "viewer:performance-issue",
                    mimeType: codecAtivo,
                    reason
                }))
            }
            status.textContent = "Desempenho insuficiente. Solicitando VP8..."
        }
    }

    function diagnosticarBuffer(){
        if(!started || video.paused || !video.buffered.length){
            amostraBufferAnterior = null
            return
        }

        const agora = performance.now()
        const posicao = video.currentTime
        const fim = video.buffered.end(video.buffered.length - 1)

        const atual = {
            tempo: agora,
            posicao,
            fim,
            atraso: fim - posicao
        }
        if(amostraBufferAnterior){
            const anterior = amostraBufferAnterior

            const tempoReal = (atual.tempo - anterior.tempo) / 1000
            const avancoVideo = atual.posicao - anterior.posicao
            const avancoBuffer = atual.fim - anterior.fim
            const variacaoAtraso = atual.atraso - anterior.atraso
            const mudancaBrusca = variacaoAtraso < -0.4

            if(mudancaBrusca || agora - ultimoLogDiagnostico >= 5000){
                log(
                    `[Drift] Atraso: ${atual.atraso.toFixed(3)}s | ` +
                    `Tempo real: ${tempoReal.toFixed(3)}s | ` +
                    `Video: +${avancoVideo.toFixed(3)}s | ` +
                    `Buffer: +${avancoBuffer.toFixed(3)}s | ` +
                    `Variação: ${variacaoAtraso.toFixed(3)}s` +
                    `Velocidade: ${video.playbackRate}`
                )
                ultimoLogDiagnostico = agora
            }
        }
        amostraBufferAnterior = atual
    }

    function conectar() {
        const token = keyInput.value.trim();

        if (!token) {
            status.textContent =
                "Digite a chave de visualização.";
            return;
        }

        if (!window.MediaSource) {
            status.textContent = "MediaSource indisponível.";
            return;
        }

        if (socket) return;

        connectButton.disabled = true;
        disconnectButton.disabled = false;

        status.textContent = "Conectando ao relay MSE...";

        const url =
            `wss://${clientId}.discordsays.com/.proxy/ws-mse`;

        console.log("[Activity MSE] Conectando:", url);

        const ws = new WebSocket(url);

        socket = ws;
        ws.binaryType = "arraybuffer";

        ws.addEventListener("open", () => {
            if (socket !== ws) return;

            ws.send(JSON.stringify({
                type: "viewer:join",
                token
            }));

            // Evita manter a chave preenchida na interface.
            keyInput.value = "";

            status.textContent =
                "Autenticando espectador...";
        });

        ws.addEventListener("message", event => {
            if (socket !== ws) return;

            // Dados binários representam segmentos WebM.
            if (event.data instanceof ArrayBuffer) {
                if (!mediaSource) return
                queue.push(event.data);

                queuedBytes += event.data.byteLength;
                segments++;

                if (
                    segments <= 3 ||
                    segments % 10 === 0
                ) {
                    log(
                        `Segmento ${segments}: ` +
                        `${event.data.byteLength} bytes`
                    );
                }

                if (queuedBytes > 16 * 1024 * 1024) {
                    log(
                        "Fila muito grande; conexão encerrada."
                    );

                    desconectar();
                    return;
                }

                anexarProximo();
                return;
            }

            let mensagem;

            try {
                mensagem = JSON.parse(event.data);
            } catch {
                return;
            }

            switch (mensagem.type) {
                case "viewer:ready":
                    status.textContent = "Autenticado. Aguardando segmentos...";
                    log("Histórico disponível: " + `${mensagem.cachedChunks ?? "não informado"} ` + "segmentos.");
                    
                    if(mensagem.mimeType){
                        prepararMidia(mensagem.mimeType)

                        
                    }else{
                        status.textContent = "Aguardando transmissão..."
                    }

                    break;
                case "viewers:count":
                    viewersLabel.textContent = `Espectadores conectados: ${mensagem.count}`
                    break
                case "viewer:network-warning":
                    alertaRedeEm = performance.now()
                    bytesPendentesNoRelay = mensagem.bufferedBytes
                    log(`Rede congestionada:` + `${(mensagem.bufferedBytes / 1048576).toFixed(1)} MiB`)
                    break
                case "stream:ended":
                    limparMidia()
                    status.textContent = "Transmissão encerrada. Aguardando proxima."

                    log("Aguardando nova transmissão.")
                    break;

                case "stream:reset":
                    prepararMidia(mensagem.mimeType)

                    if(codecAtivo === mensagem.mimeType){
                        status.textContent = "Nova transmissão iniciada."
                    }
                    
                    log(`Nova transmissão: ${mensagem.mimeType}`)
                    break
                
                case "error":
                    log(`Servidor: ${mensagem.message}`);

                    status.textContent = mensagem.message;
                    break;

                default:
                    log(
                        `Mensagem desconhecida: ${mensagem.type}`
                    );
            }
        });

        ws.addEventListener("close", event => {
            if (socket !== ws) return;

            const denied = event.code === 1008;

            desconectar();

            status.textContent = denied
                ? "Acesso negado. Confira a chave."
                : `Relay desconectado (código ${event.code}).`;
        });


        ws.addEventListener("error", () => {
            if (socket === ws) {
                log("Erro na conexão com o relay.");
            }
        });
    }

    function prepararMidia(mimeType){
        limparMidia()

        if(!mimeType || !MediaSource.isTypeSupported(mimeType)){
            status.textContent = `Codec indisponivel: ${mimeType || "desconhecido"}`

            if(socket?.readyState === WebSocket.OPEN && mimeType){
                socket.send(JSON.stringify({
                    type: "viewer:codec-unsupported",
                    mimeType
                }))
                log("Solicitando fallback de codec.")
            }
            return
        }

        const temAudio = mimeType.includes("opus")

        soundButton.disabled = !temAudio

        video.muted = !temAudio || !somAtivado

        soundButton.textContent = video.muted ? "Ativar som" : "Silenciar"

        codecAtivo = mimeType
        inicioCodecEm = performance.now()

        const ms = new MediaSource()

        mediaSource = ms
        objectUrl = URL.createObjectURL(ms)
        video.src = objectUrl

        ms.addEventListener("sourceopen", () => {
            if(mediaSource !== ms) return

            try{
                const buffer = ms.addSourceBuffer(mimeType)
                sourceBuffer = buffer

                buffer.addEventListener("updateend", () => {
                    if(sourceBuffer !== buffer) return

                    acompanharBuffer()

                    if(video.buffered.length > 0){
                        const inicio = video.buffered.start(0)
                        const fim = video.buffered.end(video.buffered.length - 1)

                        if(fim - inicio > 90 && video.currentTime - inicio > 30){
                            const removerAte = video.currentTime - 30
                            buffer.remove(0, removerAte)
                            return
                        }
                    }

                    anexarProximo()
                })
                buffer.addEventListener("error", () => {
                    if(sourceBuffer !== buffer) return

                    log("Erro ao proessar WebM.")
                    status.textContent = "Erro na decodificação."
                })

                anexarProximo()
                log("SourceBuffer preparado.")
            }catch(e) {
                log(`[MSE] ${e.message}`)
                desconectar()
                status.textContent = "Falha ao preparar o MSE"
            }
        })
    }

    
    video.addEventListener("pause", () => {
        if(document.hidden && started) pausadoPorOcultacao = true
    })

    video.addEventListener("error", () => {
        if (socket) {
            log(
                "Erro de vídeo: " +
                (video.error?.message || "desconhecido")
            );
        }
    });

    document.addEventListener("visibilitychange", () => {
        if(document.hidden){
            if(started && !video.paused){
                pausadoPorOcultacao = true
            }
            return
        }

        if(!socket || !mediaSource) return

        if(!started){
            acompanharBuffer()
            return
        }

        if(video.paused && !pausadoPorOcultacao) return
        
        const buffered = video.buffered
        
        if(!buffered.length) return

        const indice = buffered.length - 1
        const inicio = buffered.start(indice)
        const fim = buffered.end(indice)

        const atraso = fim - video.currentTime

        if(atraso > 4 && !video.seeking){
            video.currentTime = Math.max(inicio, fim - 2)

            ultimoSeekEm = performance.now()

            log(
                `[Visibilidade] Retornando ao vivo.` + 
                `Atraso anterior: ${atraso.toFixed(2)}s`
            )
        }
        if(video.paused && pausadoPorOcultacao){
            video.play().then(() => {
                pausadoPorOcultacao = false
                log("[Visibilidade] Reprodução retomada.")
            }).catch(error => {
                log(`[Visibilidade] Falha ao retomar: ${error.message}`)
            })
        }else{
            pausadoPorOcultacao = false
        }
    })

    soundButton.addEventListener("click", () => {
        somAtivado = !somAtivado
        video.muted = !somAtivado

        soundButton.textContent = somAtivado ? "Silenciar" : "Ativar som"

        log(somAtivado ? "Som Ativado." : "Som silenciado.")
    })

    connectButton.addEventListener("click", conectar);

    disconnectButton.addEventListener(
        "click",
        desconectar
    );

    const monitorarInterval = window.setInterval(monitorarReproducao, 5000)
    const diagnosticoInterval = window.setInterval(diagnosticarBuffer, 5000)

    window.addEventListener("pagehide", () => {
        clearInterval(monitorarInterval)
        clearInterval(diagnosticoInterval)
        desconectar()
    });
}
