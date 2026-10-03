# Groq Studio

IDE desktop local-first construida com Electron, React e TypeScript. O aplicativo combina editor Monaco, terminal integrado, explorador de arquivos, diagramas Mermaid e um agente que usa a API da Groq para ler o projeto, propor alteracoes e executar ferramentas com aprovacao.

## Requisitos

- Windows 10/11, macOS ou Linux
- Node.js 22 ou mais recente
- npm
- uma chave da API Groq para usar o agente

## Executar em desenvolvimento

No PowerShell, dentro desta pasta:

```powershell
Copy-Item .env.example .env
notepad .env
npm install
npm run dev
```

Preencha `GROQ_API_KEY` no `.env`. As variaveis `GROQ_FAST_MODEL` e `GROQ_DEEP_MODEL` permitem trocar os modelos sem recompilar. A chave fica apenas no processo principal do Electron e nunca e exposta ao renderer.

Na tela inicial, voce pode abrir uma pasta existente pelo caminho absoluto ou criar um projeto a partir dos templates Vazio, Node + TypeScript e React + TypeScript. A criacao sempre mostra os arquivos antes da confirmacao e nunca sobrescreve uma pasta nao vazia.

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
2. Escreva uma tarefa no painel **AGENTE**.
3. Escolha `Perguntar` para revisar cada ferramenta ou `Auto workspace` para permitir operacoes limitadas ao workspace.
4. Revise propostas no diff e use **Aplicar** ou **Rejeitar**.
5. Use o terminal integrado para instalar dependencias, testar e executar o projeto.

As conversas, atividades e propostas ficam salvas e reaparecem quando o mesmo workspace e aberto novamente. Se a Groq falhar, atingir um limite temporario ou a execucao chegar ao limite de iteracoes em um ponto seguro, use **Continuar de onde parou**: o agente retoma o contexto salvo sem duplicar a solicitacao original. Execucoes interrompidas no meio de uma ferramenta ou aprovacao nao sao retomadas automaticamente, evitando repetir efeitos colaterais.

Ao editar arquivos existentes, o agente recebe uma ferramenta de substituicao localizada por trechos exatos. Ela preserva o restante do arquivo e rejeita buscas ausentes ou ambiguas. Substituicoes completas que incluam marcadores de patch ou removam uma parte anormalmente grande de um arquivo existente tambem sao bloqueadas antes de gerar uma proposta.

Arquivos sensiveis como `.env`, chaves privadas e certificados nao podem ser lidos pelas ferramentas do workspace. Operacoes de arquivo validam os caminhos contra escapes e links simbolicos. Comandos e mudancas destrutivas continuam sujeitos a aprovacao.

## Arquitetura

- `src/main`: janela Electron, IPC, persistencia, workspace, terminal e criacao de projetos.
- `src/preload`: ponte tipada e minima entre renderer e processo principal.
- `src/renderer`: shell da IDE, Monaco, terminal, Mermaid, chat, timeline e diff.
- `src/agent`: provider Groq, roteamento, contexto, runtime, permissoes e ferramentas.
- `src/shared`: contratos validados compartilhados pelos processos.

O estado de sessoes e execucoes e salvo de forma atomica no diretorio de dados do aplicativo. O renderer roda com `contextIsolation`, sem Node.js e com sandbox.

## Limites atuais do MVP

- Aplicativo local e de usuario unico, sem sincronizacao em nuvem.
- O build gera os arquivos Electron, mas ainda nao empacota instaladores `.exe`, `.dmg` ou `.AppImage`.
- MCP remoto, Git visual completo, extensoes e execucao multiagente ficam para a proxima fase.
- O agente precisa de internet e uma chave Groq valida; editor, terminal e diagramas continuam locais.
