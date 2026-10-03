# NIX — adaptação Groq Free Tier + GPT-OSS 120B

Versão: **0.2.0**  
Data: **03/10/2026**

## Objetivo

Adaptar o NIX para usar `openai/gpt-oss-120b` na Groq de forma mais inteligente e econômica, com seleção automática de esforço de raciocínio, proteção de quota e compactação de contexto sem remover as capacidades de agente implementadas anteriormente.

## Implementado nesta versão

### 1. Auto Reasoning

- `low`, `medium` e `high` suportados no request do GPT-OSS.
- Modo padrão: `auto`.
- Heurística local no Free Tier para não gastar uma chamada apenas classificando a tarefa.
- Consultas/localizações simples → `low`.
- Implementações normais → `medium`.
- Debugging difícil, arquitetura, migração, refatoração ampla e tarefas complexas → `high`.
- Seleção manual Low/Medium/High disponível nas Configurações.
- A execução mostra o modelo e o reasoning ativo no painel de atividade.

### 2. Groq Free Tier Governor

- Preset **120B Free** na interface.
- Modelos rápido e profundo normalizados para `openai/gpt-oss-120b`.
- IDs antigos `openai/gpt-oss-120` e `openai/gpt-oss-20` são migrados automaticamente para os IDs com `b`.
- Proteção adaptativa pode rebaixar `high → medium → low` quando a quota fica apertada.
- Limite de uma execução simultânea no modo Free Tier.
- Espera automática do reset de TPM quando o header da Groq informa uma janela curta e vale a pena aguardar.
- Orçamento de conclusão reduzido automaticamente conforme o consumo diário/TPM se aproxima dos limites configurados.

### 3. Monitor de quota

- Leitura dos headers de RPD/TPM retornados pela Groq quando disponíveis.
- Exibição de requisições/dia, tokens/minuto e horário de reset.
- Contador local estimado de tokens/dia.
- Ledger diário persistente no diretório de dados do Electron.
- Atualização visual periódica no painel Configurações.

### 4. Context Budget Manager

- Orçamento padrão Free Tier: **3.600 tokens de entrada**.
- Máximo padrão de conclusão/raciocínio: **2.200 tokens**.
- Envelope protegido no Free Tier: configuração sanitizada para manter entrada + conclusão em até ~7.000 tokens.
- Schemas das ferramentas agora entram no cálculo do orçamento de contexto.
- Resultados muito grandes de `read_file`, terminal e outras tools são compactados.
- O NIX prioriza instrução principal + contexto recente + troca de tools mais recente.
- Histórico antigo é descartado antes de comprometer a solicitação atual.

### 5. Economia de chamadas

- No Free Tier, o roteamento da tarefa é local: não gasta uma chamada Groq só para escolher fast/deep/reasoning.
- Título de chat é gerado localmente no Free Tier.
- Prompt instrui o agente a preferir índice do workspace antes de leituras repetidas.
- Loop de `read_file` repetido continua protegido e força o agente a usar o contexto já obtido.

### 6. Subagentes

- `planner`, `reviewer`, `debugger` e `architect` usam `high` automaticamente quando o reasoning está em Auto.
- `tester` usa `medium` em Auto.
- O modo manual de reasoning substitui essa escolha.
- No Free Tier, subagentes recebem contexto compactado e saída mais curta.

### 7. Preservado da versão Intelligence

- Skill Engine / Superpowers.
- Workspace Intelligence com símbolos e grafo de imports.
- Memória persistente do projeto.
- Planner/Reviewer/Debugger/Tester/Architect.
- Verification Engine.
- Central de Execuções.
- Busca.
- Git visual.
- MCP stdio.
- Autopilot/permissões.
- Aplicar/Rejeitar todas as propostas.
- Aprovar/Recusar todas as perguntas da execução.
- Imports clicáveis.
- Correção do terminal/espaço.
- Tratamento de ChangeConflict e propostas consolidadas.

## Preset recomendado

```text
Modelo rápido: openai/gpt-oss-120b
Modelo profundo: openai/gpt-oss-120b
Reasoning: Automático
Groq Free Tier: Ativo
Proteção: Adaptativa
Context budget: 3600
Max completion/reasoning: 2200
Execuções simultâneas: 1
Monitor diário: 200000
```

Na tela **Configurações**, basta clicar em **Usar preset 120B Free** e depois em **Salvar configurações**.

## Segurança

O ZIP de entrega não inclui o arquivo `.env` com a chave Groq. Mantenha o `.env` que já existe no seu computador ou copie `.env.example` para `.env` e informe apenas localmente:

```env
GROQ_API_KEY=sua_chave_aqui
```

## Validação realizada aqui

- **96 arquivos TS/TSX** passaram pelo parser/transpilador TypeScript global com **0 erros sintáticos**.
- Foi executado teste direto do sanitizador de configurações:
  - padrão: `120b / auto / 3600 / 2200 / 1 execução`;
  - valores excessivos no Free Tier foram reduzidos para um envelope de até 7.000 tokens.
- Foi executado teste direto do compactador considerando schemas de tools; a amostra foi reduzida de ~2.846 para ~1.780 tokens dentro de um orçamento de 1.800.
- `npm run typecheck`, `npm test -- --run` e `npm run build` não puderam ser concluídos neste ambiente porque a instalação das dependências falhou por resolução de rede/DNS (`EAI_AGAIN`) no registry npm. Isso não foi tratado como aprovação falsa dos testes.

## Teste recomendado no Windows

Preserve primeiro seu `.env` atual e extraia o pacote em uma pasta limpa.

```powershell
cd C:\projects\ai-agent-orchestrator
npm install
npm run typecheck
npm test -- --run
npm run build
npm run dev
```

Depois abra **Configurações → Groq + GPT-OSS → Usar preset 120B Free → Salvar configurações**.

### Testes funcionais rápidos

1. `Onde fica o serviço de autenticação?` → deve tender a **LOW**.
2. `Adicione validação nesse formulário` → deve tender a **MEDIUM**.
3. `Investigue a causa raiz deste bug e corrija, rode testes e revise o diff` → deve tender a **HIGH**.
4. Abra Configurações e confira o cartão de quota após a primeira chamada.
5. Verifique que no Free Tier só uma execução roda por vez e as demais aguardam na fila.
6. Teste **Aplicar todas**, **Rejeitar todas**, **Aprovar todas** e **Recusar todas**.
7. Teste Ctrl/Cmd+clique ou duplo clique em import local.
8. Teste a tecla espaço no terminal integrado.

