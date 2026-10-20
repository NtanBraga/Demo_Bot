Option Explicit

Dim shell, caminhoProjeto, caminhoNode, comando, resultado

Set shell = CreateObject("WScript.Shell")

' Caminho da pasta principal do projeto
caminhoProjeto = "F:\demobot\activity"

' Caminho do executável Node.js
caminhoNode = "C:\Program Files\nodejs\node.exe"

' Define a pasta de trabalho
shell.CurrentDirectory = caminhoProjeto

' Monta o comando do relay
comando = """" & caminhoNode & """ --env-file=.env.webrtc .\signaling\webrtcRelay.cjs"

' Executa sem mostrar a janela
resultado = shell.Run(comando, 0, True)

WScript.Quit resultado