const startButton = document.getElementById("start")
const stopButton = document.getElementById("stop")

const preview = document.getElementById("preview")
const statusHTMLHTML = document.getElementById("statusHTML")
const info = document.getElementById("info")

let captureStream = null

async function iniciarCaptura() {
    if(captureStream) return

    if(!navigator.mediaDevices?.getDisplayMedia){
        statusHTML.textContent = "Este navegador não suporta captura de tela."
        return
    }

    try{
        console.log("[Demo Live] Solicitando captura...")

        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: { ideal: 30 },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        })

        captureStream = stream

        preview.srcObject = stream
        await preview.play()

        const videoTrack= stream.getVideoTracks()[0]
        const settings = videoTrack.getSettings()

        statusHTML.textContent = "Captura ativa (somente pré-visualização)."

        info.textContent =
            `${settings.width}x${settings.height} | ` +
            `Audio: ${stream.getAudioTracks().length > 0 ? "Sim" : "Não"}`
        
        startButton.disabled = true
        stopButton.disabled = false

        videoTrack.addEventListener("ended", pararCaptura)

        console.log("[Demo Live] Captura iniciada: ", settings)
    }catch(error){
        console.error("[Demo Live] Erro: ", error)
        pararCaptura()
        if(error.name === "NotAllowedError"){
            statusHTML.textContent = "Captura cancelada ou não autorizada."
        }else{
            statusHTML.textContent = `Erro ao capturar: ${error.message}`
        }
    }
}
function pararCaptura(){
    if(captureStream) {
        captureStream.getTracks().forEach(track => track.stop())
        captureStream = null
    }

    preview.pause()
    preview.srcObject = null

    startButton.disabled = false
    stopButton.disabled = true

    statusHTML.textContent = "Nenhuma tela sendo capturada."
    info.textContent = ""

    console.error("[Demo Live] Captura Encerrada")
}

startButton.addEventListener("click", iniciarCaptura)
stopButton.addEventListener("click", pararCaptura)

window.addEventListener("pagehide", pararCaptura)