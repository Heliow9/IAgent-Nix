# NIX 0.2.8 — correção Groq request failed

## Causa tratada
A versão 0.2.7 forçava `tool_choice` para `workspace_overview` em tarefas dependentes do workspace. Esse caminho pode ser rejeitado pela API/modelo antes de qualquer etapa local, resultando em uma execução com 0 etapas e a mensagem genérica `Groq request failed`.

## Alterações
- A inspeção inicial do workspace agora é executada **localmente pelo NIX**, sem gastar uma chamada Groq e sem `tool_choice` forçado.
- Para assuntos reconhecíveis (por exemplo `login`, `auth`, `imports`, `checkout`, `dashboard`) o NIX também faz uma busca local curta e injeta evidências no contexto.
- As chamadas posteriores usam `tool_choice: auto`, reduzindo falhas de validação do provedor.
- Respostas genéricas acionam novo grounding local antes de tentar novamente, sem usar `tool_choice: required`.
- Erros do Groq agora preservam status e detalhe sanitizado (`failed_generation.reason`, mensagem 400/413/5xx), sem vazar API keys.

## Resultado esperado
Pedidos como `Avalia todo esse projeto... UX na tela de login` devem iniciar com atividades locais (`workspace_overview`/`search_files`) e só então chamar o GPT-OSS-120B. Se a Groq rejeitar algo, a UI passa a exibir a causa real em vez de apenas `Groq request failed`.
