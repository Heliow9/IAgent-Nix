# Groq Desktop IDE Design

## Objetivo

Transformar o prototipo atual de roteamento Groq em uma IDE desktop local para desenvolvimento assistido por IA. O produto deve permitir criar ou abrir projetos, editar codigo, conversar com um agente, gerar desenhos de arquitetura em Mermaid, executar comandos e testes e revisar as alteracoes propostas antes de aplica-las.

O primeiro release e um MVP para um unico usuario e uma unica maquina Windows. Ele deve ser executavel em desenvolvimento com `npm install` e `npm run dev`. Colaboracao em nuvem, marketplace de extensoes, sincronizacao entre maquinas e agentes paralelos ficam fora deste release.

## Decisoes principais

- Plataforma: Electron desktop.
- Interface: React, TypeScript e Vite.
- Editor: Monaco Editor.
- Terminal: xterm.js ligado a um pseudo-terminal local.
- Diagramas: Mermaid renderizado em painel de preview seguro.
- Inferencia: Groq como provedor inicial, encapsulado por uma interface de provider.
- Modelos iniciais: `openai/gpt-oss-20b` para roteamento e tarefas curtas; `openai/gpt-oss-120b` para planejamento e alteracoes complexas.
- Persistencia: arquivos JSON atomicos no diretorio de dados do Electron, sem banco nativo no MVP.
- Execucao: ferramentas locais no processo principal do Electron; nenhuma ferramenta privilegiada e executada no renderer.
- Seguranca: acesso limitado ao workspace aberto, isolamento do renderer e aprovacao humana para efeitos colaterais por padrao.

## Arquitetura

O aplicativo sera dividido em quatro limites explicitos.

### Renderer

O renderer contem apenas a interface. Ele exibe o explorador de arquivos, abas do Monaco, chat, atividades do agente, terminal, diagramas e revisao de diffs. `nodeIntegration` permanece desativado e `contextIsolation` ativado. O renderer acessa capacidades nativas apenas por uma API tipada exposta pelo preload.

### Electron main e preload

O processo principal controla janelas, dialogos, filesystem, processos, Git e persistencia. O preload expoe canais IPC pequenos e validados; nao expoe `ipcRenderer`, `fs`, `child_process` ou objetos Node genericos. Toda entrada IPC e validada por schema.

### Agent core

O agent core e independente da UI. Ele mantem o estado de cada execucao, escolhe o modelo, monta contexto, chama o Groq, valida tool calls, solicita aprovacoes e continua o loop ate produzir resposta final, ser cancelado, atingir limite ou falhar. O limite padrao sera 20 iteracoes de modelo por execucao.

### Workspace executor

O executor implementa ferramentas locais e aplica a politica de seguranca. Caminhos sao normalizados por `realpath` e precisam permanecer dentro da raiz do workspace. O executor produz eventos estruturados para que a UI nunca precise interpretar logs livres para descobrir o estado do agente.

## Estrutura do produto

O layout principal tera cinco regioes:

1. Barra de atividade para alternar entre arquivos, busca, Git, agente e configuracoes.
2. Sidebar com arvore do projeto, busca ou lista de sessoes.
3. Area central com abas Monaco e preview de Markdown/Mermaid.
4. Painel inferior com terminal, problemas e logs de execucao.
5. Painel direito do agente com conversa, plano, tool calls, aprovacoes e arquivos alterados.

O layout sera redimensionavel e persistira largura dos paineis, tema e ultima pasta aberta.

## Fluxos principais

### Criar e abrir projeto

O usuario pode abrir uma pasta existente ou criar uma nova pasta a partir de um formulario com nome, local e template. O MVP inclui templates vazio, Node + TypeScript e React + TypeScript. A criacao mostra os arquivos planejados e requer confirmacao antes de gravar.

### Editar codigo

Selecionar um arquivo abre uma aba Monaco. O usuario pode editar e salvar diretamente. Arquivos alterados exibem indicador de dirty state. Fechar uma aba com alteracoes nao salvas pede confirmacao. Arquivos binarios recebem uma tela informativa e nao sao abertos como texto.

### Conversar com o agente

O usuario descreve uma tarefa e pode anexar arquivos abertos ou selecionados. O agent core envia eventos de streaming para texto, raciocinio resumido quando fornecido pelo modelo, chamadas de ferramenta, aprovacoes, resultados, erros e conclusao. O botao de cancelar interrompe requisicoes de modelo e processos iniciados pela execucao.

### Alterar arquivos pelo agente

O agente le arquivos e busca codigo diretamente. Para criar, sobrescrever ou remover arquivos, ele produz uma proposta contendo caminho, diff e justificativa. No modo padrao `ask`, a execucao pausa ate o usuario aceitar ou rejeitar. O modo `auto-workspace`, habilitado explicitamente por sessao, permite criacao e edicao dentro do workspace, mas continua bloqueando exclusoes e comandos perigosos.

### Executar comandos

O agente pode propor comandos com `cwd`, programa, argumentos e justificativa separados; strings nao sao encaminhadas a um shell quando a execucao direta for possivel. Comandos de leitura podem executar automaticamente no modo `auto-workspace`. Instalacao de pacotes, alteracoes Git, acesso de rede, comandos destrutivos e comandos fora do workspace exigem aprovacao.

### Criar desenhos de arquitetura

O agente pode criar arquivos Markdown com blocos Mermaid e arquivos `.mmd`. O preview atualiza ao salvar. Erros de sintaxe aparecem no painel de problemas sem executar HTML arbitrario. Exportacao de SVG/PNG nao faz parte do primeiro MVP.

## Ferramentas do agente

O conjunto inicial sera pequeno e explicito:

- `list_files`: lista entradas dentro do workspace com limites de profundidade e quantidade.
- `search_files`: pesquisa texto com ripgrep e retorna resultados limitados.
- `read_file`: le uma faixa de um arquivo de texto com limite de bytes.
- `propose_file_change`: cria uma proposta de criacao ou substituicao e gera diff.
- `propose_file_delete`: cria uma proposta separada que sempre exige aprovacao.
- `run_command`: inicia processo com diretorio, programa, argumentos, timeout e politica de aprovacao.
- `get_git_status`: retorna status e diff sem alterar Git.
- `create_architecture_document`: produz Markdown/Mermaid por meio do mesmo fluxo de proposta.

Ferramentas retornam JSON estruturado. A cada chamada, o registro da ferramenta e seu resultado entram novamente no historico enviado ao modelo. A biblioteca de ferramentas enviada ao Groq sera limitada ao necessario para a fase atual da execucao.

## Roteamento e contexto

O roteador deixa de aceitar uma resposta livre e passa a usar schema com `route`, `reason` e `requiredTools`. Falha de parsing usa a rota profunda como fallback. A selecao de modelo fica em configuracao, pois IDs e disponibilidade do Groq podem mudar.

O contexto usa, nesta ordem: instrucao do sistema, regras do workspace, resumo da sessao, pedido atual, arquivos anexados, resultados recentes de ferramentas e um mapa compacto do projeto. Arquivos grandes sao lidos por faixa. Segredos comuns como `.env`, chaves privadas e arquivos de credenciais sao excluidos por padrao e so podem ser anexados por uma acao explicita do usuario.

Quando o historico ultrapassar o orcamento configurado, mensagens antigas serao substituidas por um resumo persistido, mantendo pedidos do usuario, decisoes, arquivos alterados, comandos e erros ainda relevantes.

## Estado e eventos

Uma sessao contem mensagens, execucoes e configuracao de permissao. Uma execucao tem os estados `queued`, `running`, `waiting_approval`, `completed`, `failed` ou `cancelled`.

Eventos do agent core usam uma uniao discriminada e incluem:

- `run.started`
- `assistant.delta`
- `assistant.completed`
- `tool.requested`
- `tool.started`
- `tool.completed`
- `approval.requested`
- `approval.resolved`
- `file.proposed`
- `file.applied`
- `run.failed`
- `run.cancelled`
- `run.completed`

Eventos sao persistidos antes de serem exibidos. Ao reiniciar, uma execucao que estava ativa passa a `failed` com motivo de interrupcao inesperada; aprovacoes pendentes permanecem rejeitadas por seguranca.

## Seguranca

- `.env`, chaves e tokens nao entram em contexto automaticamente.
- A chave Groq vive no processo principal e nunca e enviada ao renderer.
- URLs externas nao abrem dentro do renderer privilegiado.
- Mermaid roda com configuracao de seguranca estrita.
- Symlinks que escapem do workspace sao rejeitados.
- Saida de processo e leitura de arquivo possuem limites para evitar consumo ilimitado de memoria.
- Cada processo tem timeout, cancelamento e encerramento da arvore de filhos.
- Toda operacao com efeito colateral fica registrada com argumentos, decisao de aprovacao e resultado.
- O ZIP existente nao sera usado como fonte nem distribuido. `.env`, `node_modules`, builds e dados locais serao ignorados pelo Git e pelos pacotes.

## Tratamento de erros

Erros de rede Groq exibem mensagem recuperavel e permitem tentar novamente sem duplicar ferramentas ja concluidas. Rate limits usam backoff limitado e respeitam o cancelamento. Tool calls desconhecidas, argumentos invalidos e saidas acima do limite retornam erros estruturados ao modelo.

Falha ao aplicar arquivo preserva o original e marca a proposta como falha. Escritas usam arquivo temporario e rename atomico. Conflitos entre o conteudo usado para gerar o diff e o arquivo atual impedem aplicacao automatica e exigem nova proposta.

## Testes

- Testes unitarios para roteamento, parsing de tool calls, limites de caminho, politicas de aprovacao, diffs, persistencia e reducao de contexto.
- Testes de integracao para o loop do agente usando um provider Groq falso e um workspace temporario.
- Testes de IPC para garantir que canais nao autorizados e payloads invalidos sejam rejeitados.
- Testes de componentes para arvore, editor, chat, aprovacao e diff.
- Testes end-to-end Electron para abrir um projeto, editar um arquivo, executar um comando, aprovar uma proposta e renderizar Mermaid.
- O teste padrao nao acessa a API Groq. Um smoke test real, habilitado por variavel de ambiente, valida credenciais e streaming separadamente.

## Criterios de aceite do MVP

1. `npm install` e `npm run dev` abrem a IDE no Windows.
2. O usuario cria ou abre um workspace e navega em sua arvore.
3. Arquivos de texto abrem, editam e salvam no Monaco.
4. O terminal executa um comando no workspace e transmite a saida.
5. Uma mensagem ao agente recebe resposta Groq em streaming.
6. O agente pesquisa e le o projeto por ferramentas estruturadas.
7. Uma alteracao proposta aparece como diff e so e aplicada conforme a politica da sessao.
8. O agente pode criar um documento Mermaid e o preview o renderiza.
9. Cancelamento interrompe modelo e processos associados.
10. Historico e configuracoes sobrevivem ao reinicio.
11. Testes automatizados principais passam sem usar uma chave Groq.
12. Nenhum segredo ou acesso generico ao Node fica disponivel no renderer.

## Entrega e execucao

O MVP sera entregue no projeto atual, substituindo os scripts demonstrativos por uma estrutura organizada em `src/main`, `src/preload`, `src/renderer` e `src/agent`. Os scripts minimos serao `npm run dev`, `npm test`, `npm run typecheck` e `npm run build`.

Ao final da implementacao, o README documentara requisitos, configuracao de `GROQ_API_KEY`, execucao em desenvolvimento, testes, build e limitacoes conhecidas.
