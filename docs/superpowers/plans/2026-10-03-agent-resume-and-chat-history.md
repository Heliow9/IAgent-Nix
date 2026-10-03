# Agent Resume and Durable Chat History — Implementation Plan

## Goal

Permitir que conversas antigas reaparecam ao reabrir um workspace e que execucoes interrompidas por erro, reinicio ou limite possam continuar a partir do ultimo checkpoint seguro.

## Safety decisions

- Persistir checkpoints apenas em estados serializaveis do loop do modelo.
- Marcar o checkpoint como inseguro antes de comandos ou efeitos mutaveis; uma queda durante esse trecho nao oferece retomada automatica.
- Nunca repetir silenciosamente um comando potencialmente destrutivo.
- Limpar checkpoint ao concluir ou cancelar uma execucao.
- Preservar compatibilidade com o arquivo `sessions.json` version 1 existente por migracao tolerante.

## Tasks

1. Estender contratos e `SessionStore` com checkpoints, consulta de runs/eventos e indicador `resumable`; testar persistencia e recuperacao apos reinicio.
2. Refatorar `AgentRunner` para salvar checkpoints seguros, retomar um run falho sem duplicar a mensagem do usuario e emitir `run.resumed`; testar erro de provider, limite, reinicio e bloqueio de checkpoint inseguro.
3. Persistir propostas de arquivos no estado duravel e recarrega-las no `ChangeService`; testar apply/reject depois de reabrir o store.
4. Expor history/resume via IPC/preload e hidratar a store Zustand ao abrir workspace; manter mensagens do usuario e assistente como conversa completa.
5. Adicionar UI de historico e botao `Continuar de onde parou`, atualizar E2E/README, executar testes, typecheck, build e smoke Electron, commit e push.
