const { Decoder, tools } = require("ts-ebml")

const MAX_CACHE_BYTES = 4 * 1024 * 1024
const MAX_CACHE_AGE_MS = 15_000
const MAX_HEADER_BYTES = 256 * 1024

function criarHistoricoWebM(){
    const decoder = new Decoder()
    
    const pacotes = []

    const clusters = []

    let totalBytes = 0
    let inicializacao = null
    let clusterAtual = null
    let erro = false

    let faixaAtual = null
    let numeroFaixaVideo = null

    function partesEntre(inicio, fim){
        const partes = []

        for(const pacote of pacotes){
            if(pacote.fim <= inicio) continue
            if(pacote.inicio >= fim) break

            const a = Math.max(inicio, pacote.inicio) - pacote.inicio
            const b = Math.min(fim, pacote.fim) - pacote.inicio

            partes.push(pacote.dados.subarray(a, b))
        }
        return partes
    }
    function descartarAntes(offset){
        while(pacotes.length && pacotes[0].fim <= offset){
            pacotes.shift()
        }
        if(pacotes.length && pacotes[0].inicio < offset){
            const pacote = pacotes[0]

            pacote.dados = Buffer.from(pacote.dados.subarray(offset - pacote.inicio))
            pacote.inicio = offset
        }

        while(clusters.length && clusters[0].inicio < offset){
            clusters.shift()
        }
    }
    function limitarHistorico(){
        if(!inicializacao){
            if(totalBytes > MAX_HEADER_BYTES){
                erro = true
            }
            return
        }

        const minimoPorTamanho = totalBytes - MAX_CACHE_BYTES
        const minimoPorTempo = Date.now() - MAX_CACHE_AGE_MS
        const pontoSeguro = clusters.find(cluster => 
            cluster.keyframe && cluster.inicio >= minimoPorTamanho && cluster.horario >= minimoPorTempo
        )

        
        if(pontoSeguro){
            descartarAntes(pontoSeguro.inicio)
        }else if(pacotes.length && totalBytes - pacotes[0].inicio > MAX_CACHE_BYTES){
            descartarAntes(minimoPorTamanho)
        }
        
    }

    function adicionar(dados){
        if(erro) return

        const buffer = Buffer.from(dados)
        const inicio = totalBytes

        totalBytes += buffer.length

        pacotes.push({
            inicio,
            fim: totalBytes,
            dados: buffer
        })

        try{
            const elementos = decoder.decode(buffer)

            for(const elemento of elementos){

                if(elemento.name === "TrackEntry" && elemento.type === "m"){
                    if(!elemento.isEnd){
                        faixaAtual = {
                            numero: null,
                            tipo: null
                        }
                    }else{
                        if(faixaAtual?.tipo === 1){
                            numeroFaixaVideo = faixaAtual.numero
                            console.log("[WebM] Faixa de video identificada: ", numeroFaixaVideo)
                        }
                        faixaAtual = null
                    }
                }

                if(faixaAtual){
                    if(elemento.name === "TrackNumber"){
                        faixaAtual.numero = Number(elemento.value)
                    }
                    if(elemento.name === "TrackType"){
                        faixaAtual.tipo = Number(elemento.value)
                    }
                }

                if(elemento.name === "Cluster" && elemento.type === "m" && !elemento.isEnd){
                    if(!inicializacao){
                        if(elemento.tagStart > MAX_HEADER_BYTES){
                            erro = true
                            break
                        }
                        inicializacao = Buffer.concat(partesEntre(0, elemento.tagStart))

                        console.log("[WebM] Inicialização armazenada: ", inicializacao.length, "bytes")
                    }
                    clusterAtual = {
                        inicio: elemento.tagStart,
                        horario: Date.now(),
                        primeiroBloco: false,
                        keyframe: false
                    }
                    clusters.push(clusterAtual)
                }
                if(elemento.name === "SimpleBlock" && clusterAtual && !clusterAtual.primeiroBloco && numeroFaixaVideo !== null){

                    const bloco = tools.readBlock(elemento.data)

                    if(Number(bloco.trackNumber) === numeroFaixaVideo){
                        clusterAtual.primeiroBloco = true
                        clusterAtual.keyframe = Boolean(bloco.keyframe)
                    }
                }
            }
        }catch(error){
            erro = true

            console.error("[WebM] Erro ao analisar fluxo: ", error)
        }
        limitarHistorico()
    }
    function obterReplay(){
        if(totalBytes === 0){
            return {
                partes: [],
                bytes: 0,
                clusters: 0
            }
        }
        if(erro || !inicializacao || !pacotes.length) return null

        const inicioDisponivel = pacotes[0].inicio
        const pontoSeguro = clusters.find(cluster => cluster.keyframe && cluster.inicio >= inicioDisponivel)
    
        if(!pontoSeguro) return null

        const assinatura = Buffer.concat(partesEntre(pontoSeguro.inicio, pontoSeguro.inicio + 4)).toString("hex")

        if(assinatura !== "1f43b675"){
            console.error("[WebM] Cluster invalido no historico: ", assinatura)
            return null
        }

        const partes = [
            inicializacao,
            ...partesEntre(pontoSeguro.inicio, totalBytes)
        ]
    
        return {
            partes,
            bytes: partes.reduce((total, parte) => total + parte.length, 0),
            clusters: clusters.filter(cluster => cluster.inicio >= pontoSeguro.inicio).length
        }
    }
    return {
        adicionar,
        obterReplay,
        get bytesGuardados() {
            const recentes = pacotes.length ? totalBytes - pacotes[0].inicio : 0

            return recentes + (inicializacao?.length || 0)
        }
    }
}
module.exports = { criarHistoricoWebM }