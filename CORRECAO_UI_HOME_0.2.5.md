# NIX 0.2.5 — UI / Home

- Remove o menu nativo do Electron (File/Edit/View/Window/Help).
- Oculta a barra de menu da janela no Windows/Linux.
- Torna a logomarca NIX da barra lateral um botão para a tela inicial de seleção de workspace.
- Ao voltar para a tela inicial, cancela uma execução ativa/na fila/aguardando aprovação antes de limpar a UI, evitando trocar de workspace enquanto um agente ainda usa o workspace anterior.
- Recarrega a lista de workspaces recentes na tela inicial.
