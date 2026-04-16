import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Loader2, UserPlus } from "lucide-react";
import { AuthShowcase } from "@/components/AuthShowcase";
import { MegafoneLogo } from "@/components/MegafoneLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export default function Signup() {
  const { session, loading } = useAuth();
  const { toast } = useToast();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (session) return <Navigate to="/" replace />;

  const handleSignup = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      toast({ title: "Erro ao criar conta", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Conta criada!", description: "Voc? j? esta conectado ao painel." });
    }

    setSubmitting(false);
  };

  return (
    <div className="brand-page min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <AuthShowcase
          eyebrow="Equipe Megafone"
          title="Crie sua conta e entre na cabine de comando."
          description="Convide seu time, acompanhe a opera??o dos lan?amentos e mantenha o mesmo clima premium da identidade Megafone desde o primeiro acesso."
        />

        <Card className="brand-card brand-panel border-white/10 bg-[linear-gradient(180deg,rgba(8,24,47,0.92),rgba(6,17,34,0.9))]">
          <CardHeader className="space-y-5">
            <MegafoneLogo />
            <div className="space-y-2">
              <CardTitle className="text-3xl font-semibold text-white">Criar conta</CardTitle>
              <CardDescription className="max-w-md text-sm leading-7 text-slate-300">
                Prepare seu acesso ao cockpit de integra??es, deduplica??o e acompanhamento de resultados.
              </CardDescription>
            </div>
          </CardHeader>

          <form onSubmit={handleSignup}>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-slate-200">
                  Nome completo
                </Label>
                <Input
                  id="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  placeholder="Seu nome"
                  className="h-12 rounded-2xl border-white/10 bg-white/5 text-slate-50 placeholder:text-slate-500"
                />
              </div>

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
                  placeholder="voc?@megafone.digital"
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
                  minLength={6}
                  placeholder="Minimo de 6 caracteres"
                  className="h-12 rounded-2xl border-white/10 bg-white/5 text-slate-50 placeholder:text-slate-500"
                />
              </div>
            </CardContent>

            <CardFooter className="flex flex-col items-stretch gap-4">
              <Button type="submit" className="h-12" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Criar conta
              </Button>

              <p className="text-sm text-slate-400">
                J? tem conta?{" "}
                <Link to="/login" className="font-semibold text-[#8feeff] hover:text-white">
                  Entrar
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
