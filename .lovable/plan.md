
# Launch Hub — Plano de Implementação

## Visão Geral
Plataforma de orquestração de leads para lançamentos digitais, com autenticação, sidebar com navegação, e seletor global de lançamento.

## 1. Design System
- Cor primária: coral/laranja `#D85A30`
- Fundo claro, tipografia moderna (Inter)
- Layout: sidebar fixa à esquerda + área de conteúdo à direita

## 2. Backend (Supabase/Lovable Cloud)
- Ativar autenticação por email/senha
- Criar tabela `profiles` (id, user_id, full_name) com trigger automático no signup
- Criar tabela `launches` (id, name, created_by, created_at) para o seletor de lançamentos
- RLS em ambas as tabelas

## 3. Autenticação
- Página de Login (`/login`) — email + senha
- Página de Cadastro (`/signup`) — nome, email, senha
- Componente `AuthGuard` que protege todas as rotas internas
- Redirecionamento automático para `/login` se não autenticado

## 4. Layout Principal
- **Sidebar** com:
  - Nome do usuário logado no topo
  - Seletor global de "Lançamento ativo" (dropdown, busca da tabela `launches`)
  - Menus: Dashboard, Lançamentos, Fontes, Regras, Leads, Fila, Logs
  - Botão de Logout no rodapé
- **Área de conteúdo** à direita com as rotas correspondentes

## 5. Páginas (placeholder por enquanto)
Cada página mostra o título da seção e um texto indicando que o conteúdo será implementado:
- `/` — Dashboard
- `/launches` — Lançamentos
- `/sources` — Fontes
- `/rules` — Regras
- `/leads` — Leads
- `/queue` — Fila
- `/logs` — Logs

## 6. Fluxo de Teste
O app será testável conforme os 6 cenários descritos: redirecionamento sem login, cadastro, logout, login, navegação nos menus, e seletor de lançamento visível (vazio).
