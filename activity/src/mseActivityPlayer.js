export function montarPlayerMSE(container, clientId) {
    const section = document.createElement("section");

    section.innerHTML = `
        <hr>

        <h3>Player MediaRecorder (teste)</h3>

        <p id="mse-status">
            Informe a chave de visualização.
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
    const connectButton = section.querySelector("#mse-connect");
    const disconnectButton = section.querySelector("#mse-disconnect");
    const video = section.querySelector("#mse-video");
    const logs = section.querySelector("#mse-logs");

    const mimeType = 'video/webm; codecs="vp8"';

    let socket = null;
    let mediaSource = null;
    let sourceBuffer = null;
    let objectUrl = null;

    let started = false;
    let segments = 0;
    let queuedBytes = 0;

    const queue = [];

 
    function log(message) {
        console.log("[Activity MSE]", message);

        logs.textContent += `${message}\n`;

        if (logs.textContent.length > 4000) {
            logs.textContent = logs.textContent.slice(-3000);
        }
    }

    function limparMidia() {
        video.pause();
        video.removeAttribute("src");
        video.load();

        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
        }

        objectUrl = null;
        mediaSource = null;
        sourceBuffer = null;

        queue.length = 0;
        queuedBytes = 0;
        started = false;
        segments = 0;
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

        status.textContent = "Desconectado.";
    }

    function acompanharBuffer() {
        if (!video.buffered.length) return;

        const start = video.buffered.start(0);

        const end = video.buffered.end(
            video.buffered.length - 1
        );

        if (!started && end - start > 0.3) {
            started = true;

            video.currentTime = Math.max(
                start,
                end - 0.5
            );

            video.play()
                .then(() => {
                    status.textContent =
                        "Reproduzindo via MSE.";
                })
                .catch(error => {
                    status.textContent =
                        "Clique em Play para iniciar.";

                    log(`Autoplay: ${error.message}`);
                });

        } else if (
            started &&
            !video.paused &&
            end - video.currentTime > 4
        ) {
            video.currentTime = Math.max(
                start,
                end - 0.7
            );

            log("Atraso ajustado.");
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

    function conectar() {
        const token = keyInput.value.trim();

        if (!token) {
            status.textContent =
                "Digite a chave de visualização.";
            return;
        }

        if (
            !window.MediaSource ||
            !MediaSource.isTypeSupported(mimeType)
        ) {
            status.textContent =
                "MSE com VP8/WebM indisponível neste navegador.";
            return;
        }

        if (socket) return;

        prepararMidia()

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
                    status.textContent =
                        "Autenticado. Aguardando segmentos...";

                    log(
                        "Histórico disponível: " +
                        `${mensagem.cachedChunks ?? "não informado"} ` +
                        "segmentos."
                    );
                    break;

                case "stream:ended":
                    limparMidia()
                    status.textContent = "Transmissão encerrada. Aguardando proxima."

                    log("Aguardando nova transmissão.")
                    break;

                case "stream:reset":
                    prepararMidia()
                    status.textContent = "Nova transmissão iniciada."
                    log("Player reinicializdo para nova transmissão")
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

    function prepararMidia(){
        limparMidia()

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


    video.addEventListener("error", () => {
        if (socket) {
            log(
                "Erro de vídeo: " +
                (video.error?.message || "desconhecido")
            );
        }
    });

    connectButton.addEventListener("click", conectar);

    disconnectButton.addEventListener(
        "click",
        desconectar
    );

    window.addEventListener("pagehide", desconectar);
}
