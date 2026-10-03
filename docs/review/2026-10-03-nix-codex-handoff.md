# NIX — revisão do handoff do Codex (03/10/2026)

## Escopo desta revisão

A revisão foi feita sobre o pacote `ai-agent-orchestrator.zip`, os planos em `docs/superpowers/plans`, os ledgers em `.superpowers/sdd` e o código atual. O objetivo foi separar o que já existe no código do que ainda ficou apenas planejado ou sem verificação final.

## Correções implementadas nesta revisão

### 1. Conflito ao aplicar propostas do mesmo run

Sintoma observado: `ChangeConflictError: File changed after the proposal was created` ao pressionar **Aplicar**.

Causa provável encontrada: o mesmo run podia criar várias propostas pendentes para o mesmo arquivo, todas ancoradas no mesmo hash original. Depois que a primeira era aplicada, as seguintes se tornavam obsoletas e falhavam por conflito.

Ajuste:
- propostas pendentes do mesmo `runId + path` agora são consolidadas em uma única proposta cumulativa;
- patches posteriores passam a usar a prévia pendente como base lógica;
- propostas de runs concorrentes continuam independentes e mantêm a proteção contra sobrescrita;
- conflitos reais por edição externa continuam bloqueados;
- o IPC de aplicar/rejeitar não gera mais erro esperado no handler principal do Electron, evitando spam de `Error occurred in handler...` no console.

### 2. Aprovar/recusar tudo e aplicar/rejeitar tudo

Ajuste:
- **Aprovar todas** e **Recusar todas** nas perguntas de permissão;
- a decisão vale para as demais aprovações da execução atual;
- **Aplicar todas** e **Rejeitar todas** para lotes de propostas pendentes;
- aplicação em lote é sequencial e interrompe no primeiro conflito real, preservando segurança.

### 3. Navegação de imports

Ajuste:
- novo resolvedor de imports no processo principal;
- suporta `./`, `../`, `/`, `@/` e `~/`;
- tenta extensões TS/JS e arquivos `index.*`;
- no Monaco, **Ctrl/Cmd + clique** ou **duplo clique** no caminho do import abre o arquivo;
- caminhos de arquivo em código inline/tabelas Markdown do NIX ficam clicáveis;
- em tabelas do tipo `Arquivo | Import`, o import pode ser resolvido relativamente ao arquivo de origem e abrir o destino correto.

Limite atual: aliases personalizados de `compilerOptions.paths`/`baseUrl` ainda não são lidos do `tsconfig.json`/`jsconfig.json`.

### 4. Espaço no terminal integrado

Ajuste:
- foco explícito no xterm após abrir;
- escrita para o PTY agora passa por fila FIFO;
- tecla **Espaço** possui fallback explícito para combinações Electron/xterm em que o evento era consumido antes do `onData`;
- o fallback evita duplicar o caractere quando ele próprio faz o envio.

### 5. Loop `Agent repeatedly called read_file...`

Sintoma observado: a execução encerrava com erro após o modelo insistir na mesma leitura.

Ajuste:
- chamadas repetidas idênticas continuam sendo bloqueadas;
- o runtime não derruba mais o run apenas por esse loop;
- após repetição persistente, a rodada seguinte é enviada sem ferramentas, forçando o modelo a responder usando o contexto já obtido.

## O que o Codex já tinha implementado

Pelo código atual, já existem implementações relevantes que não estão refletidas integralmente nos checkboxes dos planos:

- histórico persistente de conversas e runs;
- checkpoints e **Continuar de onde parou**;
- propostas persistentes;
- múltiplos chats por workspace;
- títulos automáticos de chat;
- referências explícitas com `@`;
- fila FIFO com até duas execuções simultâneas;
- recentes de workspace;
- prévia ao vivo de alterações do NIX no Monaco.

O ledger antigo do MVP registra uma verificação anterior com 74 testes, typecheck, build e 2 E2E. Essa verificação é anterior às implementações mais recentes de multi-chat/scheduler e às correções desta revisão.

## O que ficou incompleto ou sem fechamento

### A. Plano de domínio/cloud-ready ficou funcionalmente parcial

O plano `conversation-domain-and-recents` especificava uma fronteira `ConversationRepository` e um `LocalConversationRepository`. Esses arquivos/interfaces não existem no código atual; as responsabilidades continuam concentradas em `SessionStore`.

Impacto:
- o recurso local funciona, mas a arquitetura ainda não está realmente desacoplada para sincronização cloud;
- qualquer futura API remota exigirá refatoração do armazenamento.

### B. Multi-chat sem todos os indicadores previstos

`ChatSidebar` existe e já cria, seleciona, pesquisa, renomeia e arquiva, porém ficaram faltando itens previstos no plano:
- badge de **executando**;
- badge de **na fila** e posição;
- badge de **aguardando aprovação**;
- indicador de conclusão/não lido para chats não selecionados;
- testes para esses estados;
- `ChatReferencePicker` dedicado não foi criado; a lógica está embutida em `AgentPanel`.

### C. Scheduler sem a verificação integrada final prevista

O scheduler e testes unitários existem, mas não foi encontrado o teste de integração planejado com três chats provando em conjunto:
- duas execuções iniciando;
- terceira aguardando;
- promoção FIFO após conclusão;
- isolamento dos eventos por chat;
- recuperação da ordem da fila após reinício.

Também não há E2E cobrindo essa jornada.

### D. Fechamento dos planos não foi registrado

Os planos mais recentes continuam com checkboxes em aberto e os ledgers não registram a fase final de verificação. Portanto, o código avançou além da documentação, mas o processo de fechamento ficou incompleto.

### E. Painéis da barra lateral ainda são placeholders

No `IdeShell`, apenas **Arquivos** está implementado. Permanecem como `Painel ... em preparacao`:
- Busca;
- Git / Source Control;
- NIX na barra de atividades;
- Configurações.

O painel NIX principal já existe à direita, então o ícone NIX da barra lateral deve ganhar uma função própria em vez de duplicar o chat.

### F. Empacotamento de produção

O README ainda registra como pendente a criação de instaladores `.exe`, `.dmg` e `.AppImage`.

## Sugestão de evolução das funcionalidades em preparação

### Prioridade 1 — estabilização antes de expandir

1. Executar suite completa: `npm run typecheck`, `npm test -- --run`, `npm run build` e E2E.
2. Criar E2E para: multi-chat, fila, retomada, imports clicáveis, lote de aprovações e terminal com espaço.
3. Adicionar uma ação de conflito no diff: **Ler versão atual e regenerar proposta**, sem sobrescrever automaticamente.
4. Ler aliases de `tsconfig/jsconfig` no resolvedor de imports.

### Prioridade 2 — transformar os quatro placeholders em recursos úteis

**Busca**
- aproveitar `workspace.search`, que já existe;
- busca por texto com case-sensitive/regex;
- agrupamento por arquivo;
- clique abre arquivo na linha/coluna;
- substituir em arquivos somente via proposta revisável do NIX.

**Git**
- status, branch atual, diff, stage/unstage e commit;
- integração por argumentos seguros, sem concatenar shell arbitrário;
- ações destrutivas sempre em modo de aprovação;
- abrir diff no mesmo componente de revisão já existente.

**NIX / Tarefas**
- usar esse painel como **Central de Execuções**, em vez de repetir o chat;
- mostrar running / waiting approval / queued / failed / completed;
- posição da fila;
- cancelar, retomar e navegar para o chat de origem;
- histórico de ferramentas e arquivos alterados.

**Configurações**
- modelos fast/deep;
- modo de permissão padrão;
- concorrência 1–2;
- shell padrão do terminal;
- limite de contexto/iterações;
- zoom/tamanho de fonte;
- teste de conexão Groq;
- credenciais devem continuar fora do renderer e, numa fase posterior, migrar para armazenamento seguro do SO.

### Prioridade 3 — inteligência de código

- índice de símbolos por workspace;
- resolução via TypeScript Language Service para `go to definition` real;
- grafo de imports/dependências;
- detecção de arquivos relacionados antes de editar;
- cache de observações de ferramentas para não reler o mesmo conteúdo;
- contexto incremental por símbolos, reduzindo tokens e loops.

### Prioridade 4 — preparar cloud/MCP de verdade

- extrair `ConversationRepository` do `SessionStore`;
- criar `LocalConversationRepository`;
- definir adapter remoto/sync separado;
- usar revisionamento/soft delete já existentes para merge;
- só depois adicionar MCP remoto e colaboração/sincronização.

## Verificação feita nesta revisão

Foi executada uma verificação sintática local com o compilador TypeScript sobre 79 arquivos `.ts/.tsx`, sem diagnósticos de sintaxe.

A instalação completa das dependências não pôde ser concluída neste ambiente porque o registry npm não estava disponível e o cache local não continha `zustand@5.0.15`. Por isso, **não** considero `npm test`, `npm run typecheck` e `npm run build` validados aqui. Eles devem ser executados no Windows antes de substituir o build em produção.
