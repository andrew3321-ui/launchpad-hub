import { useMemo, useState } from "react";
import { Clock3, Loader2, LockKeyhole, LogOut, ShieldAlert } from "lucide-react";
import { MegafoneLogo } from "@/components/MegafoneLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export function AuthAccessGate() {
  const { profile, completeInitialPasswordChange, signOut } = useAuth();
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submittingPassword, setSubmittingPassword] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const approvalMessage = useMemo(() => {
    if (!profile) return null;

    if (profile.approval_status === "rejected") {
      return {
        icon: ShieldAlert,
        title: "Cadastro reprovado",
        description:
          "Seu acesso ainda não foi liberado pela administração da Megafone Digital. Fale com um admin para revisar o cadastro.",
      };
    }

    return {
      icon: Clock3,
      title: "Aguardando aprovação de um admin",
      description:
        "Sua conta já foi criada e a senha já pode ser atualizada, mas o acesso ao painel só será liberado depois que um administrador aprovar este cadastro.",
      };
  }, [profile]);

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (newPassword.length < 8) {
      toast({
        title: "Senha muito curta",
        description: "Use pelo menos 8 caracteres para concluir o primeiro acesso.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "As senhas não conferem",
        description: "Repita a mesma senha nos dois campos.",
        variant: "destructive",
      });
      return;
    }

    setSubmittingPassword(true);

    try {
      await completeInitialPasswordChange(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      toast({
        title: "Senha atualizada",
        description: "Seu primeiro acesso foi protegido com sucesso.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível atualizar a senha.";
      toast({
        title: "Erro ao atualizar senha",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSubmittingPassword(false);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);

    try {
      await signOut();
      window.location.replace("/login");
    } finally {
      setSigningOut(false);
    }
  };

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (profile.must_change_password) {
    return (
      <div className="brand-page min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-xl items-center justify-center">
          <Card className="brand-card brand-panel w-full border-white/10 bg-[linear-gradient(180deg,rgba(8,24,47,0.96),rgba(6,17,34,0.94))]">
            <CardHeader className="space-y-5">
              <MegafoneLogo />
              <div className="space-y-2">
                <CardTitle className="text-3xl font-semibold text-white">Proteja seu primeiro acesso</CardTitle>
                <CardDescription className="text-sm leading-7 text-slate-300">
                  {profile.is_admin
                    ? "Os admins iniciais entram sem aprovação manual, mas precisam atualizar a senha antes de usar o painel."
                    : "Antes de continuar, atualize sua senha. Depois disso o cadastro fica aguardando aprovação de um admin da Megafone Digital."}
                </CardDescription>
              </div>
            </CardHeader>

            <form onSubmit={handlePasswordSubmit}>
              <CardContent className="space-y-5">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                  Conta vinculada: <span className="font-medium text-white">{profile.email}</span>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-password" className="text-slate-200">
                    Nova senha
                  </Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    minLength={8}
                    required
                    placeholder="Pelo menos 8 caracteres"
                    className="h-12 rounded-2xl border-white/10 bg-white/5 text-slate-50 placeholder:text-slate-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-slate-200">
                    Confirmar nova senha
                  </Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={8}
                    required
                    placeholder="Repita a senha"
                    className="h-12 rounded-2xl border-white/10 bg-white/5 text-slate-50 placeholder:text-slate-500"
                  />
                </div>
              </CardContent>

              <CardFooter className="flex flex-col items-stretch gap-3">
                <Button type="submit" className="h-12" disabled={submittingPassword}>
                  {submittingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                  Atualizar senha e continuar
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="h-12 border-white/10 bg-white/5 text-slate-200"
                  onClick={() => void handleSignOut()}
                  disabled={signingOut}
                >
                  {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                  Sair
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>
    );
  }

  const StatusIcon = approvalMessage?.icon || Clock3;

  return (
    <div className="brand-page min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-xl items-center justify-center">
        <Card className="brand-card brand-panel w-full border-white/10 bg-[linear-gradient(180deg,rgba(8,24,47,0.96),rgba(6,17,34,0.94))]">
          <CardHeader className="space-y-5">
            <MegafoneLogo />
            <div className="space-y-3">
              <div className="brand-chip w-fit border-white/10 bg-white/5 text-[#aef4ff]">
                <StatusIcon className="h-3.5 w-3.5" />
                Controle de acesso
              </div>
              <CardTitle className="text-3xl font-semibold text-white">{approvalMessage?.title}</CardTitle>
              <CardDescription className="text-sm leading-7 text-slate-300">
                {approvalMessage?.description}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
              Usuário: <span className="font-medium text-white">{profile.email}</span>
            </div>
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-50">
              Assim que um admin aprovar seu cadastro, o painel será liberado automaticamente neste mesmo login.
            </div>
          </CardContent>
          <CardFooter>
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full border-white/10 bg-white/5 text-slate-200"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
            >
              {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Sair
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
