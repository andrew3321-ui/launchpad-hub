

# Fix: Projeto criando infinitamente

## Diagnóstico

O botão "Criar" fica girando indefinidamente. Analisando o código do `ProjectDialog.tsx`, o problema mais provável é que uma das queries do Supabase está falhando silenciosamente ou demorando sem retorno adequado. A tabela de projetos também mostra "Carregando..." sem resolver.

Problemas identificados:

1. **`fetchRows` em Projects.tsx** — faz duas queries sequenciais (projects + launches). Se a segunda query falhar, `setLoading(false)` nunca é chamado porque não há tratamento de erro adequado.
2. **`handleSave` em ProjectDialog.tsx** — se o `delete` de `uchat_workspaces` falhar silenciosamente (RLS pode bloquear para um projeto recém-criado se o `savedId` ainda não propagou), o fluxo trava.
3. **Trigger `handle_new_user` inexistente** — o sistema reporta "There are no triggers in the database", o que pode significar que o profile do usuário não foi criado. Isso pode causar problemas em cascata na sidebar (nome do usuário).

## Plano de Correção

### 1. Adicionar tratamento de erro robusto em `Projects.tsx > fetchRows`
- Envolver as queries em try/catch
- Garantir `setLoading(false)` sempre execute no `finally`

### 2. Corrigir `ProjectDialog.tsx > handleSave`
- Envolver todo o fluxo de save em try/catch/finally
- Garantir `setSaving(false)` sempre execute no `finally`
- Adicionar log de erro se o insert falhar

### 3. Recriar o trigger `handle_new_user`
- Migration para garantir que o trigger `on_auth_user_created` existe no `auth.users`
- Isso garante que profiles são criados automaticamente no signup

### 4. Corrigir `ProjectContext.tsx > fetchProjects`
- Adicionar try/catch para não travar se a query falhar
- Garantir `setLoading(false)` no finally

## Arquivos alterados
- `src/pages/Projects.tsx` — try/catch/finally em fetchRows
- `src/components/projects/ProjectDialog.tsx` — try/catch/finally em handleSave
- `src/contexts/ProjectContext.tsx` — try/catch/finally em fetchProjects
- Migration SQL — recriar trigger handle_new_user

