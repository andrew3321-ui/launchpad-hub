import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Check, Loader2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface PendingSignupRequest {
  created_at: string;
  email: string;
  full_name: string | null;
  id: string;
  must_change_password: boolean;
  user_id: string;
}

function formatRequestedAt(value: string) {
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
}

export function AdminApprovalsBell() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [requests, setRequests] = useState<PendingSignupRequest[]>([]);

  const isAdmin = profile?.is_admin && profile.approval_status === "approved" && !profile.must_change_password;

  const loadRequests = useCallback(async () => {
    if (!isAdmin) {
      setRequests([]);
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.rpc("list_pending_signup_requests");

      if (error) {
        throw error;
      }

      setRequests(((data || []) as PendingSignupRequest[]).sort((a, b) => {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível carregar os pedidos pendentes.";
      toast({
        title: "Erro ao buscar aprovações",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, toast]);

  useEffect(() => {
    if (!isAdmin) return;

    void loadRequests();

    const intervalId = setInterval(() => {
      void loadRequests();
    }, 10000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isAdmin, loadRequests]);

  const pendingCount = requests.length;

  const emptyMessage = useMemo(() => {
    if (!isAdmin) {
      return "As aprovações de cadastro ficam disponíveis apenas para admins.";
    }

    return "Nenhum pedido pendente no momento.";
  }, [isAdmin]);

  const reviewRequest = async (profileId: string, nextStatus: "approved" | "rejected") => {
    if (!isAdmin || actioningId) return;

    setActioningId(profileId);

    try {
      const { error } = await supabase.rpc("review_signup_request", {
        next_status: nextStatus,
        target_profile_id: profileId,
      });

      if (error) {
        throw error;
      }

      setRequests((current) => current.filter((request) => request.id !== profileId));
      toast({
        title: nextStatus === "approved" ? "Cadastro aprovado" : "Cadastro reprovado",
        description:
          nextStatus === "approved"
            ? "O usuário já pode entrar no painel assim que concluir a troca obrigatória de senha."
            : "O cadastro foi marcado como reprovado e seguirá bloqueado.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível revisar este cadastro.";
      toast({
        title: "Erro ao revisar cadastro",
        description: message,
        variant: "destructive",
      });
    } finally {
      setActioningId(null);
      void loadRequests();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
        >
          <Bell className="h-4 w-4" />
          {pendingCount > 0 && (
            <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-semibold text-slate-950">
              {pendingCount > 9 ? "9+" : pendingCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] border-white/10 bg-[#08162b]/95 p-0 text-slate-100">
        <div className="border-b border-white/10 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Aprovações de acesso</p>
              <p className="text-xs text-slate-400">Novos cadastros aguardando decisão dos admins.</p>
            </div>
            {isAdmin && (
              <Badge variant="outline" className="border-white/10 bg-white/5 text-[#aef4ff]">
                {pendingCount} pendente{pendingCount === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
        </div>

        {!isAdmin ? (
          <div className="px-4 py-6 text-sm text-slate-400">{emptyMessage}</div>
        ) : loading && requests.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-6 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando pedidos de aprovação...
          </div>
        ) : requests.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-400">{emptyMessage}</div>
        ) : (
          <ScrollArea className="max-h-[420px]">
            <div className="space-y-3 p-4">
              {requests.map((request) => {
                const actioning = actioningId === request.id;

                return (
                  <div key={request.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">
                          {request.full_name?.trim() || "Novo usuário Megafone"}
                        </p>
                        <p className="truncate text-xs text-[#aef4ff]">{request.email}</p>
                      </div>
                      <UserPlus className="mt-0.5 h-4 w-4 shrink-0 text-[#8feeff]" />
                    </div>

                    <div className="mt-3 space-y-1 text-xs text-slate-400">
                      <p>Solicitado em {formatRequestedAt(request.created_at)}</p>
                      <p>
                        Primeiro acesso:{" "}
                        {request.must_change_password ? "senha ainda precisa ser atualizada" : "senha já atualizada"}
                      </p>
                    </div>

                    <div className="mt-4 flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={actioning}
                        onClick={() => void reviewRequest(request.id, "approved")}
                      >
                        {actioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-white/10 bg-white/5 text-slate-200"
                        disabled={actioning}
                        onClick={() => void reviewRequest(request.id, "rejected")}
                      >
                        {actioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        Reprovar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
