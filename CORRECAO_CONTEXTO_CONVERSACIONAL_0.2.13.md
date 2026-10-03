# NIX 0.2.13 — continuidade contextual do chat

## Problema
Perguntas curtas de continuação, como **“E na API?”**, eram tratadas como uma nova solicitação isolada. O histórico estava presente no contexto, porém roteamento, grounding local, seleção de ferramentas e reparo de tool calls usavam apenas a mensagem atual. Isso fazia o NIX pesquisar/listar tudo relacionado à palavra `api`, em vez de preservar o objetivo da pergunta anterior.

## Correção
- Novo resolvedor local de follow-ups (`follow-up-context.ts`), sem gastar chamada Groq.
- Detecta continuações curtas como `E na API?`, `E no mobile?`, `E nessa tela?`, `E quanto ao backend?`.
- Preserva a intenção anterior para roteamento e seleção de ferramentas.
- Injeta uma nota de continuidade antes da mensagem atual para o GPT-OSS.
- O grounding local prioriza o novo foco e não repete automaticamente os termos da pergunta anterior.
- O prompt de sistema agora proíbe tratar follow-up elíptico como busca isolada por palavra-chave.
- Mantém a mensagem literal do usuário no chat; a expansão contextual é apenas interna.

## Exemplo
Anterior: `Quais melhorias de UX podem ser aplicadas nas telas do dashboard PWA?`

Follow-up: `E na API?`

O NIX passa a interpretar internamente como: continuar o mesmo objetivo/critério da conversa, agora aplicado à API, sem despejar uma listagem de todos os símbolos que contenham `api`.
