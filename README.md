# Launch Hub

## Fluxo recomendado de ambiente

### Desenvolvimento e testes
- Use um projeto Supabase proprio enquanto o schema e as integracoes ainda estao mudando.
- O app permite trocar o backend em runtime pela interface usando token da conta.
- Depois de conectar o projeto de testes, aplique as migrations de `supabase/migrations/` normalmente com Supabase CLI ou SQL editor.

### Voltar para o backend do Lovable
- Quando for subir o codigo novamente para o ambiente do Lovable, volte as variaveis `.env` e `supabase/config.toml` para o projeto original.
- No primeiro uso desse backend, valide o schema pelo card `Schema do backend` dentro do app.
- Se o card apontar itens ausentes, use o arquivo `supabase/bootstrap.sql` ou rode os arquivos de `supabase/migrations/` em ordem cronologica.

## Importante

O frontend usa apenas a chave publica do Supabase. Por seguranca, ele nao cria tabelas ou colunas diretamente no banco. Por isso o projeto inclui:
- validacao visual do schema atual
- SQL bootstrap consolidado para ambientes novos
- migrations versionadas em `supabase/migrations/`

## Backend atual do app

O schema cobre:
- autenticacao e perfis
- lancamentos e conexoes de fontes
- regras de deduplicacao
- contatos tratados
- identidades externas
- eventos recebidos
- logs de processamento
