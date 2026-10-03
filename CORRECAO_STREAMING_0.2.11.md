# NIX 0.2.11 — correção de travamento/crash durante respostas longas

## Sintoma observado

Durante respostas longas, a interface começava a travar e podia aparentar crashar. Ao fechar o NIX e abrir novamente, a resposta completa aparecia no histórico.

Isso indicava que o processo principal continuava recebendo e persistindo a resposta da Groq, enquanto o renderer (React) ficava sobrecarregado durante o streaming.

## Causa

O `AgentRunner` publicava um evento `assistant.delta` para praticamente cada fragmento recebido da Groq. O renderer atualizava o Zustand a cada evento e o `AgentPanel` re-renderizava o chat inteiro. Além disso, `MarkdownContent` reprocessava Markdown das mensagens em cada atualização e o texto parcial corrente era parseado novamente desde o início.

Com modelos rápidos, isso podia gerar centenas de atualizações em poucos segundos. O custo crescia conforme a resposta ficava maior.

## Correções

### 1. Batching de streaming

Os deltas agora são acumulados e publicados em lotes. O flush ocorre aproximadamente a cada 80 ms ou quando o buffer atinge 384 caracteres, além de um flush final obrigatório.

Isso reduz muito o volume de IPC e de atualizações do Zustand/React sem perder nenhum caractere da resposta.

### 2. Renderização leve durante streaming

Enquanto a resposta ainda está sendo gerada, o NIX exibe texto com `white-space: pre-wrap`, sem reprocessar toda a sintaxe Markdown a cada lote.

Ao concluir, a mensagem persistida volta a usar o `MarkdownContent` completo, mantendo tabelas, listas, títulos, código e links.

### 3. Markdown memoizado

`MarkdownContent` agora usa `React.memo`, evitando que mensagens antigas e já concluídas sejam parseadas novamente sempre que chega um novo delta da resposta atual.

### 4. Sem duplicação no fechamento da execução

Quando `assistant.completed` já inseriu a mensagem final no histórico, o bloco de streaming é ocultado imediatamente, sem esperar `run.completed`.

## Persistência

A persistência final não foi removida nem reduzida. A resposta completa continua sendo salva pelo processo principal; a mudança afeta apenas a frequência e a forma de atualização visual durante a geração.

## Validação local neste pacote

- 101 arquivos TS/TSX analisados sintaticamente: 0 erros de parsing.
- teste de runtime atualizado para validar coalescência dos deltas.
- versão: 0.2.11.

A validação definitiva de `typecheck`, Vitest e build deve ser executada pelo `TESTAR_NIX_WINDOWS.ps1` no Windows do projeto.
