import { Outlet, useLocation } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useLaunch } from "@/contexts/LaunchContext";
import { MegafoneLogo } from "@/components/MegafoneLogo";
import { AppSidebar } from "./AppSidebar";
import { AdminApprovalsBell } from "./AdminApprovalsBell";

const pageTitles: Record<string, string> = {
  "/": "Dashboard de operação",
  "/launches": "Arquitetura de experts",
  "/experts": "Arquitetura de experts",
  "/sources": "Conexão de fontes",
  "/rules": "Regras de tratamento",
  "/leads": "Base tratada de contatos",
  "/queue": "Fila operacional",
  "/logs": "Observabilidade e logs",
};

export function AppLayout() {
  const location = useLocation();
  const { connection } = useAuth();
  const { activeLaunch } = useLaunch();

  return (
    <SidebarProvider>
      <div className="brand-page min-h-screen w-full">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_top,rgba(57,213,255,0.24),transparent_60%)]" />
        <div className="flex min-h-screen w-full gap-4 p-3 sm:p-4">
          <AppSidebar />

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="brand-grid-surface sticky top-3 z-20 mb-4 flex min-h-[72px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <SidebarTrigger className="border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10" />
                <div className="min-w-0">
                  <p className="brand-kicker hidden sm:block">Megafone Digital</p>
                  <h1 className="truncate text-lg font-semibold text-white sm:text-2xl">
                    {pageTitles[location.pathname] || "Painel Megafone"}
                  </h1>
                </div>
              </div>

              <div className="hidden min-w-0 items-center gap-3 lg:flex">
                <Badge variant="outline" className="brand-chip max-w-[280px] truncate border-white/10 bg-white/5 text-slate-200">
                  <Sparkles className="h-3.5 w-3.5 text-[#8feeff]" />
                  {activeLaunch ? activeLaunch.name : "Nenhum expert ativo"}
                </Badge>
                <Badge variant="outline" className="brand-chip border-white/10 bg-white/5 text-slate-200">
                  Supabase {connection.projectRef}
                </Badge>
              </div>

              <div className="flex items-center gap-3">
                <AdminApprovalsBell />
                <div className="hidden xl:block">
                  <MegafoneLogo compact />
                </div>
              </div>
            </header>

            <main className="flex-1">
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}
