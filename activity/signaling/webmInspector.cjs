const { Decoder, tools } = require("ts-ebml")

function criarInspectorWebM(){
    const decoder = new Decoder()

    let clusters = 0
    let keyframes = 0
    let primeiroCluster = null

    function analisar(buffer){
        try{
            const elementos = decoder.decode(buffer)

            for(const elemento of elementos){
                if(elemento.name === "Cluster" && elemento.type === "m" && !elemento.isEnd){
                    clusters++

                    if(primeiroCluster === null){
                        primeiroCluster = elemento.tagStart

                        console.log("[WebM] Inicialização termina no byte: ", primeiroCluster)
                    }
                    console.log("[WebM] Cluster: ", {
                        numero: clusters,
                        offset: elemento.tagStart,
                        tamanhoDesconhecido: elemento.unknownSize === true
                    })
                }

                if(elemento.name === "SimpleBlock"){
                    const bloco = tools.readBlock(elemento.data)
                    if(bloco.keyframe){
                        keyframes++

                        if(keyframes <= 5 || keyframes % 30 === 0){
                            console.log("[WebM] Keyframe: ", {
                                numero: keyframes,
                                offset: elemento.tagStart,
                                clusterAtual: clusters
                            })
                        }
                    }
                }
            }
        }catch(error){
            console.error("[WebM] Erro na analise: ", error.message)
        }
    }
    return { analisar }
}
module.exports = { criarInspectorWebM }