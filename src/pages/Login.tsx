import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Loader2, LockKeyhole, Sparkles } from "lucide-react";
import { AuthShowcase } from "@/components/AuthShowcase";
import { MegafoneLogo } from "@/components/MegafoneLogo";
import { SchemaSetupCard } from "@/components/SchemaSetupCard";
import { SupabaseConnectionCard } from "@/components/SupabaseConnectionCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export default function Login() {
  const { session, loading } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (session) return <Navigate to="/" replace />;

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        8000,
        "O login demorou demais para responder. Atualize a pagina e tente novamente.",
      );

      if (error) {
        toast({ title: "Erro ao entrar", description: error.message, variant: "destructive" });
      }
    } catch (error) {
      const message = error instanceof Error  error.message : "Não foi possível concluir o login.";
      toast({ title: "Erro ao entrar", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="brand-page min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <AuthShowcase />

        <div className="space-y-6">
          <Card className="brand-card brand-panel border-white/10 bg-[linear-gradient(180deg,rgba(8,24,47,0.92),rgba(6,17,34,0.9))]">
            <CardHeader className="space-y-5">
              <MegafoneLogo />

              <div className="space-y-3">
                <div className="brand-chip w-fit border-white/10 bg-white/5 text-[#aef4ff]">
                  <Sparkles className="h-3.5 w-3.5" />
                  Acesso ao painel
                </div>
                <CardTitle className="text-3xl font-semibold text-white">Entre na operação Megafone</CardTitle>
                <CardDescription className="max-w-md text-sm leading-7 text-slate-300">
                  Conecte suas bases, monitore o tratamento automático e acompanhe cada lead em um ambiente com identidade Megafone.
                </CardDescription>
              </div>
            </CardHeader>

            <form onSubmit={handleLogin}>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-200">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    placeholder="você@megafone.digital"
                    className="h-12 rounded-2xl border-white/10 bg-white/5 text-slate-50 placeholder:text-slate-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-slate-200">
                    Senha
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    placeholder="Digite sua senha"
                    className="h-12 rounded-2xl border-white/10 bg-white/5 text-slate-50 placeholder:text-slate-500"
                  />
                </div>
              </CardContent>

              <CardFooter className="flex flex-col items-stretch gap-4">
                <Button type="submit" className="h-12" disabled={submitting}>
                  {submitting  <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                  Entrar no painel
                </Button>

                <p className="text-sm text-slate-400">
                  Não tem conta{" "}
                  <Link to="/signup" className="font-semibold text-[#8feeff] hover:text-white">
                    Criar conta
                  </Link>
                </p>
              </CardFooter>
            </form>
          </Card>

          <SupabaseConnectionCard
            title="Conexão Supabase"
            description="Troque rapidamente o backend ativo durante desenvolvimento e homologação, sem rebuild."
          />

          <SchemaSetupCard
            title="Validação do schema"
            description="Confira se o backend conectado já recebeu todas as estruturas que o app precisa para operar."
          />
        </div>
      </div>
    </div>
  );
}
