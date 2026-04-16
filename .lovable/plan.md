<final-text>
Atualização do plano para corrigir de vez o travamento em "Criar":

## Diagnóstico do que encontrei
O ajuste anterior foi parcial. O comportamento ainda pode travar porque:

1. O `ProjectDialog` continua dependendo de chamadas assíncronas sem proteção contra request pendente:
   - `insert/update` do projeto
   - `delete` de `uchat_workspaces`
   - `insert` dos workspaces
   Se alguma delas ficar pendente, o botão continua girando.

2. Ainda há pontos do app sem tratamento robusto de loading/erro:
   - `loadProject` em `ProjectDialog`
   - `fetchLaunches` em `LaunchContext`
   - fluxo equivalente em `LaunchDialog`
   Isso pode deixar telas em “Carregando...” sem saída.

3. O backend está inconsistente com o código:
   - a função `handle_new_user` existe
   - mas o backend reporta que **não há trigger**
   Isso indica que a migration do trigger não foi aplicada corretamente, mesmo estando no repositório.

4. Os logs do navegador mostram só warnings de UI (`DialogDescription` e ref no `UChatWorkspacesEditor`), não o erro real do save. Então a próxima correção precisa também expor claramente qual etapa falhou.

## Plano de correção
### 1. Blindar o fluxo de salvar projeto
- Refatorar `ProjectDialog.handleSave` para executar em etapas explícitas:
  - salvar projeto
  - remover workspaces antigos
  - inserir workspaces novos
- Validar o retorno de **cada** etapa e interromper com erro claro se qualquer uma falhar.
- Garantir `setSaving(false)` sempre no `finally`.
- Fazer `await onSaved()` para o refresh acontecer de forma determinística.

### 2. Adicionar proteção contra loading infinito
- Aplicar `try/catch/finally` completo em:
  - `ProjectDialog.loadProject`
  - `Projects.fetchRows`
  - `ProjectContext.fetchProjects`
  - `LaunchContext.fetchLaunches`
  - `LaunchDialog.loadLaunch` e `LaunchDialog.handleSave`
- Sempre religar o estado de loading no início da operação e desligar no `finally`.
- Exibir toast/mensagem de erro em vez de deixar spinner eterno.

### 3. Adicionar timeout defensivo nas chamadas críticas
- Criar um helper simples para timeout nas operações do backend mais sensíveis.
- Se a request não responder em alguns segundos, abortar o fluxo, destravar a UI e mostrar erro.
- Isso resolve o caso em que a promise nunca fecha, que é exatamente o sintoma atual do botão “Criar”.

### 4. Corrigir o estado real do backend
- Criar/aplicar migration para garantir que o trigger `on_auth_user_created` exista de verdade.
- Revisar as policies de `projects`, `uchat_workspaces`, `launches` e `launch_uchat_workspaces`.
- Verificar especialmente o fluxo “criei projeto e imediatamente salvei workspaces”.
- Aproveitar para corrigir a policy de leitura de `projects`, que hoje está aberta demais (`USING (true)`).

### 5. Limpar warnings de UI relacionados
- Adicionar `DialogDescription` nos dialogs.
- Ajustar a composição do `UChatWorkspacesEditor` para eliminar o warning de ref.
- Isso não deve ser a causa principal do travamento, mas reduz ruído e facilita depuração real.

## Como vou validar após implementar
1. Criar projeto só com nome/slug.
2. Criar projeto com ActiveCampaign + 1 workspace.
3. Criar projeto com 2 workspaces.
4. Editar projeto existente.
5. Confirmar que:
   - o botão “Criar” para de girar
   - a modal fecha
   - a lista atualiza
   - o seletor da sidebar atualiza
   - em caso de erro aparece toast claro, nunca spinner infinito

## Arquivos que devem entrar nessa correção
- `src/components/projects/ProjectDialog.tsx`
- `src/pages/Projects.tsx`
- `src/contexts/ProjectContext.tsx`
- `src/contexts/LaunchContext.tsx`
- `src/components/launches/LaunchDialog.tsx`
- migration SQL para trigger + ajuste de policies

</final-text>