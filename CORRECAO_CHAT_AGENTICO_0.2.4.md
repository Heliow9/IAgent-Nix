# NIX 0.2.4 — correção do chat genérico / inspeção de workspace

## Sintoma reproduzido

Ao receber uma tarefa concreta de engenharia, por exemplo:

> Revise toda a estrutura deste projeto. Verifique todos os imports... Não altere nenhum arquivo.

O NIX podia encerrar a primeira chamada sem usar nenhuma ferramenta e responder com uma saudação genérica como "Como posso ajudar?".

## Causa encontrada

O comportamento vinha da combinação de dois pontos:

1. O Groq recebia as ferramentas sem `tool_choice`. O padrão era `auto`, portanto o modelo podia optar por responder em texto sem inspecionar o workspace.
2. O perfil Free Tier usa `NIX_CONTEXT_TOKEN_BUDGET=3600`. Os schemas de todas as ferramentas concorriam com system prompt, skills, índice do workspace e mensagem do usuário no mesmo orçamento. Em tarefas grandes isso podia compactar agressivamente justamente o contexto que diz ao modelo para agir como agente de código.

Os testes anteriores validavam o pipeline e as tools individualmente, mas não garantiam que uma solicitação ampla de análise começasse obrigatoriamente por uma inspeção real do workspace.

## Correções da 0.2.4

- Adicionado `toolChoice` ao contrato interno do provedor.
- O GroqProvider agora envia `tool_choice` explicitamente.
- Pedidos de análise/revisão/validação do projeto forçam `workspace_overview` na primeira iteração.
- Depois da primeira inspeção, o agente volta para `tool_choice: auto` e continua o loop normalmente.
- O system prompt proíbe responder com saudação genérica quando a tarefa depende do workspace.
- As ferramentas são selecionadas por relevância e por orçamento de tokens, preservando espaço para system prompt e mensagem atual.
- Quando o usuário diz "não altere", ferramentas de escrita/proposta são removidas daquela execução.
- Temperatura das execuções do agente reduzida para 0.2 para comportamento mais determinístico.
- Adicionado teste de regressão para garantir que uma análise ampla do projeto força `workspace_overview` e não expõe ferramentas de escrita em modo somente análise.
- Adicionado teste do GroqProvider para validar o encaminhamento de `tool_choice`.

## Resultado esperado

Para o prompt de inspeção, o primeiro passo deve aparecer como atividade da ferramenta `workspace_overview`. O NIX deve então explorar o workspace e entregar diagnóstico, em vez de responder "Como posso ajudar?".

## Validação

Foi feita validação sintática dos 103 arquivos TypeScript/TSX do pacote: 0 erros de sintaxe.

O typecheck/test/build completo deve ser executado no Windows com `TESTAR_NIX_WINDOWS.ps1`, usando as dependências locais do projeto.
