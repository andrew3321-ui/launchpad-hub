import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  KeyRound,
  Loader2,
  Shield,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SchemaSetupCard } from "@/components/SchemaSetupCard";
import { SupabaseConnectionCard } from "@/components/SupabaseConnectionCard";
import { useAuth } from "@/contexts/AuthContext";
import { useLaunch } from "@/contexts/LaunchContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface AssignedExpert {
  assignedAt?: string | null;
  id: string;
  name: string;
  slug?: string | null;
  status?: string | null;
}

interface AdminUserOverview {
  approval_status: string;
  assigned_experts: AssignedExpert[];
  created_at: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  must_change_password: boolean;
  password_changed_at: string | null;
  profile_id: string;
  user_id: string;
}

function formatDate(value: string | null) {
  if (!value) return "Nao informado";

  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
}

function normalizeAssignedExperts(value: unknown): AssignedExpert[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;

      return {
        assignedAt: typeof record.assignedAt === "string" ? record.assignedAt : null,
        id: typeof record.id === "string" ? record.id : "",
        name: typeof record.name === "string" ? record.name : "Expert sem nome",
        slug: typeof record.slug === "string" ? record.slug : null,
        status: typeof record.status === "string" ? record.status : null,
      };
    })
    .filter((item): item is AssignedExpert => Boolean(item.id));
}

export default function Settings() {
  const { profile, displayName, connection, refreshProfile } = useAuth();
  const { launches, refreshLaunches } = useLaunch();
  const { toast } = useToast();

  const [ownPassword, setOwnPassword] = useState("");
  const [ownPasswordConfirmation, setOwnPasswordConfirmation] = useState("");
  const [savingOwnPassword, setSavingOwnPassword] = useState(false);

  const [adminUsers, setAdminUsers] = useState<AdminUserOverview[]>([]);
  const [loadingAdminUsers, setLoadingAdminUsers] = useState(false);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, string[]>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [savingAssignmentsFor, setSavingAssignmentsFor] = useState<string | null>(null);
  const [resettingPasswordFor, setResettingPasswordFor] = useState<string | null>(null);
  const [deletingUserFor, setDeletingUserFor] = useState<string | null>(null);
  const [userPendingDelete, setUserPendingDelete] = useState<AdminUserOverview | null>(null);

  const isAdmin = Boolean(
    profile?.is_admin && profile.approval_status === "approved" && !profile.must_change_password,
  );

  const adminSummary = useMemo(() => {
    const admins = adminUsers.filter((user) => user.is_admin).length;
    const regularUsers = adminUsers.length - admins;
    const pendingUsers = adminUsers.filter((user) => user.approval_status === "pending").length;

    return { admins, regularUsers, pendingUsers };
  }, [adminUsers]);

  const loadAdminUsers = useCallback(async () => {
    if (!isAdmin) {
      setAdminUsers([]);
      setAssignmentDrafts({});
      return;
    }

    setLoadingAdminUsers(true);

    try {
      const { data, error } = await supabase.rpc("list_admin_user_access_overview");

      if (error) {
        throw error;
      }

      const users = ((data ?? []) as unknown as AdminUserOverview[]).map((user) => ({
        ...user,
        assigned_experts: normalizeAssignedExperts(user.assigned_experts),
      }));

      setAdminUsers(users);
      setAssignmentDrafts(
        users.reduce<Record<string, string[]>>((drafts, user) => {
          drafts[user.user_id] = user.assigned_experts.map((expert) => expert.id);
          return drafts;
        }, {}),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel carregar os usuarios.";
      toast({ title: "Erro ao carregar usuarios", description: message, variant: "destructive" });
    } finally {
      setLoadingAdminUsers(false);
    }
  }, [isAdmin, toast]);

  useEffect(() => {
    void loadAdminUsers();
  }, [loadAdminUsers]);

  const handleOwnPasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (ownPassword.length < 8) {
      toast({
        title: "Senha muito curta",
        description: "Use pelo menos 8 caracteres.",
        variant: "destructive",
      });
      return;
    }

    if (ownPassword !== ownPasswordConfirmation) {
      toast({
        title: "As senhas nao conferem",
        description: "Repita a mesma senha nos dois campos.",
        variant: "destructive",
      });
      return;
    }

    setSavingOwnPassword(true);

    try {
      const { error } = await supabase.auth.updateUser({ password: ownPassword });

      if (error) {
        throw error;
      }

      setOwnPassword("");
      setOwnPasswordConfirmation("");
      await refreshProfile();

      toast({
        title: "Senha atualizada",
        description: "Sua senha foi alterada com sucesso.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel atualizar sua senha.";
      toast({ title: "Erro ao atualizar senha", description: message, variant: "destructive" });
    } finally {
      setSavingOwnPassword(false);
    }
  };

  const callAdminUserManagement = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("admin-user-management", { body });

    if (error) {
      throw error;
    }

    const response = data as { error?: string } | null;
    if (response?.error) {
      throw new Error(response.error);
    }

    return response;
  };

  const toggleExpertAssignment = (userId: string, expertId: string, checked: boolean) => {
    setAssignmentDrafts((current) => {
      const currentSelection = current[userId] ?? [];
      const nextSelection = checked
        ? Array.from(new Set([...currentSelection, expertId]))
        : currentSelection.filter((id) => id !== expertId);

      return {
        ...current,
        [userId]: nextSelection,
      };
    });
  };

  const saveAssignments = async (targetUser: AdminUserOverview) => {
    if (targetUser.is_admin) return;

    setSavingAssignmentsFor(targetUser.user_id);

    try {
      const { error } = await supabase.rpc("set_user_expert_assignments", {
        target_launch_ids: assignmentDrafts[targetUser.user_id] ?? [],
        target_user_id: targetUser.user_id,
      });

      if (error) {
        throw error;
      }

      await Promise.all([loadAdminUsers(), refreshLaunches()]);
      toast({
        title: "Experts vinculados",
        description: `${targetUser.email} ja pode gerenciar os experts selecionados.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel salvar os vinculos.";
      toast({ title: "Erro ao vincular experts", description: message, variant: "destructive" });
    } finally {
      setSavingAssignmentsFor(null);
    }
  };

  const resetUserPassword = async (targetUser: AdminUserOverview) => {
    const password = passwordDrafts[targetUser.user_id]?.trim() ?? "";

    if (password.length < 8) {
      toast({
        title: "Senha muito curta",
        description: "Informe uma senha com pelo menos 8 caracteres.",
        variant: "destructive",
      });
      return;
    }

    setResettingPasswordFor(targetUser.user_id);

    try {
      await callAdminUserManagement({
        action: "reset-password",
        password,
        userId: targetUser.user_id,
      });

      setPasswordDrafts((current) => ({ ...current, [targetUser.user_id]: "" }));
      await loadAdminUsers();

      toast({
        title: "Senha redefinida",
        description: "O usuario precisara trocar a senha no proximo acesso.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel redefinir a senha.";
      toast({ title: "Erro ao redefinir senha", description: message, variant: "destructive" });
    } finally {
      setResettingPasswordFor(null);
    }
  };

  const deleteUser = async () => {
    if (!userPendingDelete || userPendingDelete.is_admin) return;

    setDeletingUserFor(userPendingDelete.user_id);

    try {
      await callAdminUserManagement({
        action: "delete-user",
        userId: userPendingDelete.user_id,
      });

      setUserPendingDelete(null);
      await Promise.all([loadAdminUsers(), refreshLaunches()]);

      toast({
        title: "Usuario excluido",
        description: "O acesso foi removido e os experts que eram dele foram preservados para o admin atual.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel excluir o usuario.";
      toast({ title: "Erro ao excluir usuario", description: message, variant: "destructive" });
    } finally {
      setDeletingUserFor(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="brand-grid-surface p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-4">
            <div className="brand-chip w-fit border-white/10 bg-white/5 text-[#aef4ff]">
              <UserCog className="h-3.5 w-3.5" />
              Perfil e configuracoes
            </div>
            <div>
              <h1 className="font-display text-4xl font-semibold text-white sm:text-5xl">
                Central de controle do usuario
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                Gerencie seu perfil, conexao Supabase, validade do schema e permissoes dos operadores em um so lugar.
              </p>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
            <p className="font-medium text-white">{connection.projectName}</p>
            <p className="mt-1 break-all text-[#aef4ff]">{connection.projectRef}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="brand-card border-white/10 bg-[linear-gradient(180deg,rgba(8,23,46,0.92),rgba(4,12,24,0.84))]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Shield className="h-5 w-5 text-primary" />
              Meu perfil
            </CardTitle>
            <CardDescription className="text-slate-300">
              Informacoes da conta autenticada e troca de senha.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Nome</p>
                <p className="mt-2 font-semibold text-white">{displayName || "Operador Megafone"}</p>
              </div>
              <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">E-mail</p>
                <p className="mt-2 break-all font-semibold text-white">{profile?.email || "-"}</p>
              </div>
              <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Perfil</p>
                <Badge className="mt-2" variant={profile?.is_admin ? "default" : "secondary"}>
                  {profile?.is_admin ? "Admin" : "Usuario"}
                </Badge>
              </div>
              <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Senha</p>
                <p className="mt-2 text-sm text-slate-200">
                  {profile?.must_change_password ? "Troca pendente" : formatDate(profile?.password_changed_at ?? null)}
                </p>
              </div>
            </div>

            <form onSubmit={handleOwnPasswordSubmit} className="space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
              <div>
                <h3 className="font-semibold text-white">Trocar minha senha</h3>
                <p className="mt-1 text-sm text-slate-400">Use pelo menos 8 caracteres.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="own-password">Nova senha</Label>
                  <Input
                    id="own-password"
                    type="password"
                    value={ownPassword}
                    onChange={(event) => setOwnPassword(event.target.value)}
                    className="h-11 rounded-2xl border-white/10 bg-[#07162c] text-slate-50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="own-password-confirmation">Confirmar senha</Label>
                  <Input
                    id="own-password-confirmation"
                    type="password"
                    value={ownPasswordConfirmation}
                    onChange={(event) => setOwnPasswordConfirmation(event.target.value)}
                    className="h-11 rounded-2xl border-white/10 bg-[#07162c] text-slate-50"
                  />
                </div>
              </div>
              <Button type="submit" disabled={savingOwnPassword}>
                {savingOwnPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Atualizar senha
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="brand-card border-white/10 bg-[linear-gradient(180deg,rgba(8,23,46,0.92),rgba(4,12,24,0.84))]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <DatabaseZap className="h-5 w-5 text-primary" />
              Saude do ambiente
            </CardTitle>
            <CardDescription className="text-slate-300">
              O estado rapido do backend ativo. A validacao completa fica logo abaixo.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Backend</p>
              <p className="mt-2 break-all text-sm font-semibold text-[#aef4ff]">{connection.projectRef}</p>
            </div>
            <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Origem</p>
              <p className="mt-2 font-semibold text-white">
                {connection.source === "runtime" ? "Token runtime" : "Projeto embutido"}
              </p>
            </div>
            <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Acesso</p>
              <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-emerald-100">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                Autenticado
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SupabaseConnectionCard
          title="Conexao Supabase"
          description="Troque rapidamente o backend ativo durante desenvolvimento e homologacao, sem rebuild."
        />
        <SchemaSetupCard
          title="Validacao do schema"
          description="Confira se o backend conectado ja recebeu todas as estruturas que o app precisa para operar."
        />
      </div>

      {isAdmin && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <div className="brand-chip w-fit border-white/10 bg-white/5 text-[#aef4ff]">
                <Users className="h-3.5 w-3.5" />
                Administracao
              </div>
              <h2 className="text-2xl font-semibold text-white">Usuarios e experts</h2>
              <p className="max-w-3xl text-sm leading-7 text-slate-300">
                Admins veem todos os experts. Usuarios normais enxergam e gerenciam apenas os experts vinculados aqui.
              </p>
            </div>
            <Button variant="outline" onClick={() => void loadAdminUsers()} disabled={loadingAdminUsers}>
              {loadingAdminUsers && <Loader2 className="h-4 w-4 animate-spin" />}
              Recarregar usuarios
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-400">Admins</p>
              <p className="mt-2 font-display text-3xl font-semibold text-white">{adminSummary.admins}</p>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-400">Usuarios normais</p>
              <p className="mt-2 font-display text-3xl font-semibold text-white">{adminSummary.regularUsers}</p>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-400">Pendentes</p>
              <p className="mt-2 font-display text-3xl font-semibold text-white">{adminSummary.pendingUsers}</p>
            </div>
          </div>

          {loadingAdminUsers ? (
            <Card className="brand-card border-white/10 bg-white/5">
              <CardContent className="flex items-center gap-3 py-8 text-slate-300">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Carregando usuarios...
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {adminUsers.map((adminUser) => {
                const selectedLaunchIds = assignmentDrafts[adminUser.user_id] ?? [];
                const isSavingAssignments = savingAssignmentsFor === adminUser.user_id;
                const isResettingPassword = resettingPasswordFor === adminUser.user_id;
                const passwordDraft = passwordDrafts[adminUser.user_id] ?? "";

                return (
                  <Card
                    key={adminUser.user_id}
                    className="brand-card border-white/10 bg-[linear-gradient(180deg,rgba(8,23,46,0.92),rgba(4,12,24,0.84))]"
                  >
                    <CardHeader>
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="break-words text-xl text-white">
                              {adminUser.full_name?.trim() || "Usuario Megafone"}
                            </CardTitle>
                            <Badge variant={adminUser.is_admin ? "default" : "secondary"}>
                              {adminUser.is_admin ? "Admin" : "Usuario"}
                            </Badge>
                            <Badge variant={adminUser.approval_status === "approved" ? "outline" : "destructive"}>
                              {adminUser.approval_status}
                            </Badge>
                          </div>
                          <CardDescription className="mt-2 break-all text-slate-300">
                            {adminUser.email}
                          </CardDescription>
                        </div>

                        <div className="text-sm text-slate-400 lg:text-right">
                          <p>Criado em {formatDate(adminUser.created_at)}</p>
                          <p>
                            Senha:{" "}
                            {adminUser.must_change_password
                              ? "troca pendente"
                              : formatDate(adminUser.password_changed_at)}
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                        <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                              <h3 className="font-semibold text-white">Experts vinculados</h3>
                              <p className="mt-1 text-sm text-slate-400">
                                {adminUser.is_admin
                                  ? "Admins ja acessam todos os experts."
                                  : "Selecione um ou mais experts para liberar no painel desse usuario."}
                              </p>
                            </div>
                            <Badge variant="outline">{adminUser.is_admin ? "todos" : `${selectedLaunchIds.length} selecionado(s)`}</Badge>
                          </div>

                          {adminUser.is_admin ? (
                            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm text-cyan-50">
                              Nao precisa vincular manualmente: este admin consegue ver e ajustar todas as configuracoes.
                            </div>
                          ) : launches.length === 0 ? (
                            <div className="rounded-2xl border border-white/10 bg-[#07162c] p-4 text-sm text-slate-400">
                              Nenhum expert cadastrado ainda.
                            </div>
                          ) : (
                            <div className="grid gap-3 md:grid-cols-2">
                              {launches.map((launch) => {
                                const checked = selectedLaunchIds.includes(launch.id);

                                return (
                                  <label
                                    key={launch.id}
                                    className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-[#07162c] p-3 text-sm transition hover:border-cyan-300/40"
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(nextChecked) =>
                                        toggleExpertAssignment(adminUser.user_id, launch.id, nextChecked === true)
                                      }
                                    />
                                    <span className="min-w-0">
                                      <span className="block truncate font-medium text-white">{launch.name}</span>
                                      <span className="block truncate text-xs text-slate-400">{launch.slug || launch.id}</span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}

                          {!adminUser.is_admin && (
                            <Button
                              className="mt-4"
                              type="button"
                              onClick={() => void saveAssignments(adminUser)}
                              disabled={isSavingAssignments}
                            >
                              {isSavingAssignments && <Loader2 className="h-4 w-4 animate-spin" />}
                              Salvar vinculos
                            </Button>
                          )}
                        </div>

                        <div className="space-y-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
                          <div>
                            <h3 className="font-semibold text-white">Seguranca do usuario</h3>
                            <p className="mt-1 text-sm text-slate-400">
                              Ao redefinir, o usuario troca a senha no proximo acesso.
                            </p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`password-${adminUser.user_id}`}>Nova senha temporaria</Label>
                            <Input
                              id={`password-${adminUser.user_id}`}
                              type="password"
                              value={passwordDraft}
                              onChange={(event) =>
                                setPasswordDrafts((current) => ({
                                  ...current,
                                  [adminUser.user_id]: event.target.value,
                                }))
                              }
                              className="h-11 rounded-2xl border-white/10 bg-[#07162c] text-slate-50"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              onClick={() => void resetUserPassword(adminUser)}
                              disabled={isResettingPassword}
                            >
                              {isResettingPassword ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <KeyRound className="h-4 w-4" />
                              )}
                              Redefinir senha
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              onClick={() => setUserPendingDelete(adminUser)}
                              disabled={adminUser.is_admin}
                              title={adminUser.is_admin ? "Admins nao podem ser excluidos por aqui" : undefined}
                            >
                              <Trash2 className="h-4 w-4" />
                              Excluir usuario
                            </Button>
                          </div>
                          {adminUser.is_admin && (
                            <div className="flex gap-2 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-50">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                              Admins ficam protegidos contra exclusao manual neste painel.
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      )}

      <AlertDialog open={Boolean(userPendingDelete)} onOpenChange={(open) => !open && setUserPendingDelete(null)}>
        <AlertDialogContent className="border-white/10 bg-[#07162c] text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuario?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-300">
              O acesso de {userPendingDelete?.email} sera removido. Experts criados por esse usuario serao preservados
              e transferidos para o admin atual antes da exclusao.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/5 text-slate-200">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void deleteUser()}
              disabled={Boolean(deletingUserFor)}
            >
              {deletingUserFor && <Loader2 className="h-4 w-4 animate-spin" />}
              Excluir usuario
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
