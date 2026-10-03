# NIX

IDE desktop local-first construida com Electron, React e TypeScript. O NIX combina editor Monaco, terminal integrado, explorador de arquivos, diagramas Mermaid e um agente que usa a API da Groq para ler o projeto, propor alteracoes e executar ferramentas com aprovacao.

## Requisitos

- Windows 10/11, macOS ou Linux
- Node.js 22 ou mais recente
- npm
- uma chave da API Groq para usar o agente


## Perfil Groq Free Tier + GPT-OSS 120B

Esta versao vem preparada para `openai/gpt-oss-120b` com controle de raciocinio e quota. Em **Configuracoes > Groq + GPT-OSS**, use **Usar preset 120B Free** para ativar:

- `reasoning_effort` automatico: `low`, `medium` ou `high` conforme a complexidade da tarefa;
- protecao adaptativa de quota e espera do reset de TPM quando for util;
- orçamento de contexto de 3.600 tokens e maximo de conclusao/raciocinio de 2.200 tokens;
- uma execucao simultanea no Free Tier;
- monitor de RPD/TPM usando os headers retornados pela Groq e contador diario estimado persistente;
- compactacao de contexto que contabiliza tambem os schemas das ferramentas;
- classificacao local de tarefas no Free Tier, evitando gastar uma requisicao apenas para escolher o modelo/esforco;
- titulos de chat locais no Free Tier, evitando outra requisicao desnecessaria.

O modo **Auto** usa `low` para consultas/localizacoes simples, `medium` para implementacoes normais e `high` para debugging, arquitetura, refatoracoes amplas e tarefas complexas. A protecao adaptativa pode reduzir `high -> medium -> low` quando a quota estiver apertada. O usuario ainda pode forcar Low/Medium/High manualmente.

A chave `GROQ_API_KEY` nao deve ser commitada nem compartilhada. O pacote distribuivel usa `.env.example`; mantenha sua chave apenas no `.env` local.

## Executar em desenvolvimento

No PowerShell, dentro desta pasta:

```powershell
Copy-Item .env.example .env
notepad .env
npm install
npm run dev
```

Preencha `GROQ_API_KEY` no `.env`. As variaveis `GROQ_FAST_MODEL` e `GROQ_DEEP_MODEL` permitem trocar os modelos sem recompilar. A chave fica apenas no processo principal do Electron e nunca e exposta ao renderer.

Na tela inicial, voce pode reabrir um dos cinco projetos recentes, pesquisar em todos os workspaces conhecidos, abrir uma pasta pelo caminho absoluto ou criar um projeto a partir dos templates Vazio, Node + TypeScript e React + TypeScript. A criacao sempre mostra os arquivos antes da confirmacao e nunca sobrescreve uma pasta nao vazia.

## Comandos

```powershell
npm run dev          # abre o aplicativo em modo desenvolvimento
npm test -- --run    # executa os testes uma vez
npm run typecheck    # valida os tipos
npm run build        # gera os artefatos em out/
npm run preview      # abre o build local
npm run test:e2e     # teste desktop; fica ignorado sem RUN_E2E=1
npm run smoke:groq   # fica ignorado sem RUN_GROQ_SMOKE=1
```

Para os testes opcionais reais:

```powershell
$env:RUN_E2E='1'; npm run test:e2e
$env:RUN_GROQ_SMOKE='1'; npm run smoke:groq
```

Execute `npm run build` antes do E2E. O smoke da Groq consome uma requisicao pequena da sua conta.

## Fluxo do agente

1. Abra ou crie um workspace.
2. Crie ou selecione uma conversa no painel **NIX** e escreva uma tarefa.
3. Escolha `Perguntar` para revisar cada ferramenta ou `Auto workspace` para permitir operacoes limitadas ao workspace.
4. Revise propostas no diff e use **Aplicar** ou **Rejeitar**. Quando houver varias decisoes, use **Aplicar todas/Rejeitar todas**; nas perguntas de permissao, **Aprovar todas/Recusar todas** vale para o restante da execucao atual.
5. Use o terminal integrado para instalar dependencias, testar e executar o projeto.

Cada workspace pode ter varias conversas independentes, com titulo automatico baseado no assunto, renomeacao, arquivamento, busca e citacao explicita de outra conversa usando `@`. Conversas, atividades e propostas ficam salvas e reaparecem quando o mesmo workspace e aberto novamente. A concorrencia e configuravel; no preset Groq Free Tier ela fica limitada a uma execucao por vez para proteger o TPM. As demais tarefas entram em uma fila FIFO e iniciam automaticamente quando uma vaga e liberada.

Se a Groq falhar, atingir um limite temporario ou a execucao chegar ao limite de iteracoes em um ponto seguro, use **Continuar de onde parou**: o agente retoma o contexto salvo sem duplicar a solicitacao original. Execucoes interrompidas no meio de uma ferramenta ou aprovacao nao sao retomadas automaticamente, evitando repetir efeitos colaterais.

As atividades tecnicas ficam agrupadas em uma unica linha no chat. A linha mostra a acao atual durante o trabalho e, ao final, a quantidade de etapas e arquivos alterados. Clique em **Detalhes** para consultar ferramentas, alvos e resultados, inclusive quando a resposta nao precisou de ferramenta. O chat acompanha imediatamente a mensagem mais recente, renderiza titulos, listas, tabelas, links e blocos de codigo em Markdown e orienta o agente a responder sempre em portugues do Brasil.

O agente recebe o historico recente da conversa para compreender referencias como "esse arquivo" e "o que acabamos de discutir". Pedidos para abrir um arquivo usam uma acao dedicada que seleciona o arquivo no Monaco; o conteudo nao e despejado no chat e a resposta fica limitada a uma confirmacao curta.

Imports locais reconhecidos no Monaco podem ser abertos com **Ctrl/Cmd + clique** ou **duplo clique**. O resolvedor entende caminhos relativos, `@/`, `~/`, extensoes TypeScript/JavaScript e `index.*`. Caminhos de arquivo e imports exibidos nas tabelas Markdown do NIX tambem podem abrir o arquivo correspondente no editor.

Se o modelo insistir em chamar a mesma leitura com os mesmos argumentos, o runtime bloqueia a repeticao e força a proxima rodada a responder com o contexto ja obtido, em vez de encerrar a tarefa com `Agent repeatedly called ...`.

Ao editar arquivos existentes, o agente recebe uma ferramenta de substituicao localizada por trechos exatos. Ela preserva o restante do arquivo e rejeita buscas ausentes ou ambiguas. Substituicoes completas que incluam marcadores de patch ou removam uma parte anormalmente grande de um arquivo existente tambem sao bloqueadas antes de gerar uma proposta.

Quando o arquivo alterado ja esta aberto, o Monaco mostra o NIX escrevendo a proposta em tempo real. Essa exibicao e apenas uma previa protegida: o conteudo real do buffer e qualquer edicao local nao salva permanecem intactos ate **Aplicar**. Ao rejeitar, a previa desaparece sem gravar o arquivo.

Arquivos sensiveis como `.env`, chaves privadas e certificados nao podem ser lidos pelas ferramentas do workspace. Operacoes de arquivo validam os caminhos contra escapes e links simbolicos. Comandos e mudancas destrutivas continuam sujeitos a aprovacao.

## Arquitetura

- `src/main`: janela Electron, IPC, persistencia, workspace, terminal e criacao de projetos.
- `src/preload`: ponte tipada e minima entre renderer e processo principal.
- `src/renderer`: shell da IDE, Monaco, terminal, Mermaid, chat, timeline e diff.
- `src/agent`: provider Groq, roteamento, contexto, runtime, permissoes e ferramentas.
- `src/shared`: contratos validados compartilhados pelos processos.

O estado de sessoes e execucoes e salvo de forma atomica no diretorio de dados do aplicativo. O renderer roda com `contextIsolation`, sem Node.js e com sandbox.

## Limites atuais do MVP

- Aplicativo local e de usuario unico; os registros ja possuem identidade, revisao e exclusao logica para facilitar uma futura sincronizacao em nuvem.
- O build gera os arquivos Electron, mas ainda nao empacota instaladores `.exe`, `.dmg` ou `.AppImage`.
- MCP por `stdio`, busca, painel Git e Central de Execucoes ja estao disponiveis; transporte MCP remoto/HTTP e empacotamento final ainda podem ser ampliados.
- O agente precisa de internet e uma chave Groq valida; editor, terminal e diagramas continuam locais.


## 0.2.8 — Groq grounded runtime
A inspeção inicial do workspace é executada localmente antes da primeira chamada ao Groq, evitando tool_choice forçado e reduzindo consumo/erros no Free Tier. Erros do provedor agora exibem detalhes sanitizados.

## 0.2.10 — análise completa de monorepo/workspace
O índice do NIX agora mapeia recursivamente projetos e subprojetos detectados por manifestos (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pubspec.yaml` e outros), incluindo estruturas como `apps/api`, `apps/dashboard` e `apps/mobile`. Pedidos de análise de todo o projeto recebem esse mapa antes da chamada ao modelo e buscas relevantes são executadas separadamente em cada subprojeto para evitar que uma área do monorepo seja ignorada.

Consultas somente de análise/UX/revisão deixam de oferecer `run_command` e `verify_workspace` ao modelo quando o usuário não pediu execução, evitando testes/builds desnecessários. A compactação de contexto também preserva explicitamente a solicitação atual do usuário mesmo quando evidências locais são anexadas depois dela. No Windows, comandos `.cmd/.bat` executados pelo verificador usam shell compatível, corrigindo falhas de `spawn ENOENT/EINVAL` com `npm.cmd`.

## 0.2.11 — streaming estável e anti-crash

- agrupa deltas de streaming antes de atravessar o IPC do Electron;
- reduz drasticamente a quantidade de updates React por segundo durante respostas longas;
- durante o streaming, renderiza texto leve em vez de reprocessar Markdown completo a cada token;
- memoriza mensagens Markdown concluídas para não reprocessar respostas antigas em cada delta;
- evita duplicar a resposta no instante entre `assistant.completed` e `run.completed`;
- mantém a resposta completa persistida no histórico e aplica a formatação Markdown ao finalizar.

## 0.2.12 — linguagem do editor e diagnósticos sem falsos positivos

- Mantém detecção por extensão para TypeScript/TSX, JavaScript/JSX, Python e demais linguagens.
- Adiciona suporte explícito a `.mts`, `.cts`, `.mjs` e `.cjs`.
- Configura o Monaco para JSX/React moderno e módulos Node/ESNext.
- Desativa apenas a validação semântica do worker TypeScript isolado do Monaco, que não enxerga o filesystem/node_modules do workspace e marcava imports válidos em vermelho.
- Mantém erros de sintaxe locais visíveis no editor.
- Diagnóstico semântico real continua sendo responsabilidade do TypeScript/linters do próprio projeto, executados no workspace real.
