# Workspaces recentes e conversas multi-chat preparadas para cloud

## Objetivo

Evoluir o Groq Studio para que o usuário possa reabrir projetos recentes, manter várias conversas independentes por workspace, executar até duas tarefas simultâneas e enfileirar tarefas adicionais. A estrutura deve continuar local-first, mas permitir sincronização futura com um aplicativo Expo e um backend cloud sem reescrever a UI, o agente ou o agendador.

## Escopo

Esta entrega inclui:

- cinco workspaces recentes na tela inicial;
- lista pesquisável de todos os workspaces;
- registro de workspace mesmo antes do primeiro uso do agente;
- múltiplos chats por workspace;
- lista de chats recolhível no painel do agente;
- criação, seleção, renomeação e arquivamento de chats;
- título contextual gerado pela Groq após a primeira mensagem;
- referências explícitas a outros chats do mesmo workspace;
- duas execuções simultâneas e fila persistente para as demais;
- migração compatível dos dados persistidos atuais;
- contratos de domínio independentes do Electron e preparados para sincronização.

Não fazem parte desta entrega:

- backend cloud;
- autenticação de usuário;
- sincronização real entre dispositivos;
- upload automático do código-fonte local;
- prioridades manuais ou dependências entre tarefas;
- colaboração em tempo real entre usuários.

## Modelo de domínio

### Workspace

- `id`: UUID estável.
- `name`: nome apresentado ao usuário.
- `localRootPath`: caminho disponível somente no desktop local.
- `remoteProjectId?`: vínculo futuro com uma fonte remota.
- `createdAt`, `updatedAt`, `lastOpenedAt`: datas ISO.
- `revision`: número de revisão para sincronização futura.
- `deletedAt?`: exclusão lógica sincronizável.

### Chat

- `id`: UUID estável.
- `workspaceId`: workspace proprietário.
- `title`: título atual.
- `titleSource`: `provisional`, `generated` ou `manual`.
- `status`: `active` ou `archived`.
- `summary`: resumo compacto para referências entre chats.
- `createdAt`, `updatedAt`: datas ISO.
- `revision` e `deletedAt?`.

### Message

- `id`: UUID estável.
- `chatId`: chat proprietário.
- `role`: `user`, `assistant`, `system` ou `tool`.
- `content`: conteúdo textual.
- `attachments`: referências a arquivos ou artefatos.
- `referencedChatIds`: IDs resolvidos das referências explícitas.
- `createdAt`, `revision` e `deletedAt?`.

### Run

- `id`: UUID estável.
- `chatId`: chat proprietário.
- `status`: `queued`, `running`, `waiting_approval`, `completed`, `failed` ou `cancelled`.
- `queueSequence?`: ordem persistente de entrada na fila.
- eventos, propostas e checkpoint associados.
- `createdAt`, `updatedAt` e `revision`.

## Limites e abstrações

O domínio será definido em contratos compartilhados sem dependências de Electron, Node ou React. A persistência será acessada por uma interface `ConversationRepository`, com operações para workspaces, chats, mensagens, execuções e mudanças pendentes.

Nesta fase haverá uma implementação local baseada no armazenamento atômico atual. Uma futura implementação sincronizada poderá combinar cache local e API cloud preservando os mesmos contratos. Mudanças persistidas terão IDs gerados no cliente, revisão e exclusão lógica, permitindo fila de sincronização e resolução de conflitos no futuro.

`localRootPath` nunca será tratado como dado portável. No aplicativo Expo, o workspace poderá existir sem acesso ao diretório local. Conteúdo de código exigirá futuramente uma fonte remota separada, como GitHub ou armazenamento próprio.

## Migração

O esquema persistido receberá uma nova versão. Na primeira abertura:

1. cada `SessionRecord` atual será convertido em um `Workspace` e um `Chat`;
2. mensagens serão ligadas ao novo `chatId`;
3. runs, eventos, propostas e checkpoints manterão seus IDs e serão ligados ao chat convertido;
4. workspaces duplicados por diferenças de barra ou capitalização serão unificados com normalização compatível com a plataforma;
5. a migração será gravada atomicamente e o arquivo anterior continuará recuperável pelo mecanismo de corrupção/backup existente.

## Workspaces recentes

Abrir ou criar um workspace atualiza `lastOpenedAt`. A tela inicial mostra os cinco primeiros registros não excluídos, ordenados por acesso recente. Se houver mais itens, o botão **Mostrar todos** abre uma lista pesquisável.

Cada item exibe nome, caminho local e último acesso. Selecioná-lo tenta abrir o diretório imediatamente. Se o diretório não existir, o registro permanece disponível com o estado **Pasta não encontrada** e o usuário pode escolher outro workspace.

## Interface multi-chat

O painel do agente terá uma lista lateral recolhível com:

- **Novo chat**;
- busca por título;
- chats ativos ordenados por atualização;
- seção de chats arquivados;
- ações para renomear e arquivar;
- indicadores de execução, aprovação, fila, erro e conteúdo não visualizado.

Quando recolhida, a lista mostra apenas o chat atual e um controle para expandir. Trocar de chat não cancela nem pausa sua execução. O conteúdo central apresenta somente mensagens, execuções, propostas e aprovações do chat selecionado.

## Títulos automáticos

O primeiro envio cria imediatamente um título provisório derivado da mensagem. Depois, uma chamada curta ao modelo rápido da Groq gera um título contextual em português. O resultado deve ser conciso e específico ao assunto.

Uma renomeação manual altera `titleSource` para `manual` e impede novas substituições automáticas. Se a geração falhar, o título provisório permanece e uma única nova tentativa pode ocorrer após a primeira resposta.

## Referências entre chats

Digitar `@` abre um seletor pesquisável contendo outros chats do mesmo workspace. A escolha cria um chip visual e persiste o `referencedChatId`, evitando depender apenas do texto do título.

O contexto do agente recebe o resumo do chat citado e os caminhos de arquivos relevantes registrados nele. O histórico completo não é copiado automaticamente. Chats arquivados continuam citáveis; referências para chats excluídos são apresentadas como indisponíveis.

## Agendador de execuções

Um `RunScheduler` independente da UI controla no máximo duas execuções ativas em todo o aplicativo.

Ao enviar uma mensagem:

1. a mensagem e a run são persistidas;
2. referências são resolvidas;
3. se houver menos de duas execuções ativas, a run inicia;
4. caso contrário, recebe estado `queued` e `queueSequence` crescente;
5. quando uma execução termina, falha ou é cancelada, a primeira run válida da fila inicia automaticamente.

A fila é persistente. Reiniciar o aplicativo preserva a ordem. Runs que estavam ativas são recuperadas como falhas retomáveis somente quando houver checkpoint seguro; runs enfileiradas continuam enfileiradas.

Cada execução possui `AbortController`, contexto, contadores de ferramentas, aprovações, propostas e checkpoint independentes. Cancelar uma run enfileirada apenas a remove da fila. Falhas em um chat não afetam execuções de outros chats.

## Concorrência de arquivos

Propostas continuam usando o hash-base do arquivo. Se duas execuções propuserem mudanças concorrentes, aplicar a segunda após alteração do arquivo produzirá conflito, exigindo nova leitura e nova proposta. Nenhuma run pode sobrescrever silenciosamente mudanças aplicadas por outra.

## Recuperação e erros

- Workspace local ausente: histórico continua acessível; editor, terminal e ferramentas locais ficam bloqueados.
- Falha ou limite da Groq: checkpoint seguro permite retomada no chat correto.
- Aprovação pendente após encerramento: é rejeitada durante recuperação para impedir repetição ambígua.
- Tarefa enfileirada inválida ou chat excluído: é cancelada com motivo persistido e a próxima tarefa inicia.
- Falha de título: mantém título provisório.
- Referência indisponível: mensagem permanece, mas o contexto sinaliza que o chat citado não existe.

## Preparação para sincronização

O repositório local registrará mudanças de domínio em uma fila de saída, sem enviá-las. Cada mudança conterá entidade, ID, revisão, operação e data. Essa estrutura servirá futuramente para sincronização incremental com cloud.

Conflitos futuros seguirão regras por entidade: mensagens e eventos são anexáveis; títulos manuais usam a revisão mais recente; exclusões usam `deletedAt`; estados de execução serão validados pelo servidor responsável pela execução. Essas regras são contratos preparatórios, não um motor de sincronização nesta fase.

## Estratégia de testes

Para limitar custo e tempo, os testes serão concentrados nos riscos principais:

- migração do esquema atual preservando dados;
- ordenação e limite dos cinco workspaces recentes;
- abertura da lista completa e de um workspace escolhido;
- isolamento de mensagens e ações entre chats;
- título provisório, geração automática e proteção do título manual;
- resolução de referência explícita a outro chat;
- duas execuções simultâneas e fila da terceira;
- promoção automática e cancelamento de item enfileirado;
- recuperação da fila após reinício;
- conflito de propostas concorrentes.

Além desses testes focados, serão executados typecheck, suíte existente, build Electron e o E2E atual para detectar regressões gerais.

## Critérios de aceite

- O usuário reabre qualquer workspace conhecido sem redigitar o caminho.
- A tela inicial mostra cinco recentes e permite pesquisar todos.
- Um workspace suporta vários chats persistentes e arquiváveis.
- Títulos são contextuais, editáveis e não sobrescrevem renomeações manuais.
- Referências explícitas fornecem contexto entre chats sem misturar automaticamente as conversas.
- Duas tarefas executam simultaneamente; tarefas adicionais entram em fila persistente.
- Estados e ações são isolados pelo chat correto.
- Dados atuais são migrados sem perda.
- A camada de domínio pode ser reutilizada por uma futura persistência cloud e pelo aplicativo Expo.
