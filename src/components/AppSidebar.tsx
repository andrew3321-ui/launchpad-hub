import { useState } from "react";
import {
  FileText,
  GitBranch,
  LayoutDashboard,
  ListOrdered,
  Loader2,
  LogOut,
  Radio,
  Rocket,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NavLink } from "@/components/NavLink";
import { MegafoneLogo } from "@/components/MegafoneLogo";
import { useAuth } from "@/contexts/AuthContext";
import { useLaunch } from "@/contexts/LaunchContext";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const menuItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Experts", url: "/experts", icon: Rocket },
  { title: "Fontes", url: "/sources", icon: Radio },
  { title: "Regras", url: "/rules", icon: GitBranch },
  { title: "Leads", url: "/leads", icon: Users },
  { title: "Fila", url: "/queue", icon: ListOrdered },
  { title: "Logs", url: "/logs", icon: FileText },
];

export function AppSidebar() {
  const { displayName, signOut } = useAuth();
  const { launches, activeLaunch, setActiveLaunch } = useLaunch();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const [signingOut, setSigningOut] = useState(false);

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

  return (
    <Sidebar variant="floating" collapsible="icon" className="border-none">
      <SidebarHeader className="space-y-4 p-4">
        {collapsed ? (
          <div className="flex justify-center">
            <MegafoneLogo compact showSubtitle={false} />
          </div>
        ) : (
          <div className="space-y-4">
            <MegafoneLogo />

            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 shadow-[0_18px_45px_rgba(2,8,20,0.26)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{displayName || "Operador Megafone"}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.28em] text-[#91ecff]/75">Painel de controle</p>
                </div>
                <Badge variant="outline" className="border-white/10 bg-white/5 text-[#aef4ff]">
                  Online
                </Badge>
              </div>

              <div className="mt-4 space-y-2">
                <p className="text-[0.7rem] font-medium uppercase tracking-[0.32em] text-slate-400">Expert ativo</p>
                <Select
                  value={activeLaunch?.id || ""}
                  onValueChange={(id) => {
                    const launch = launches.find((item) => item.id === id);
                    setActiveLaunch(launch || null);
                  }}
                >
                  <SelectTrigger className="h-11 rounded-full border-white/10 bg-[#09182f]/85 text-left text-sm text-slate-100">
                    <SelectValue placeholder="Selecionar expert" />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#08162b] text-slate-100">
                    {launches.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-slate-400">Nenhum expert</div>
                    ) : (
                      launches.map((launch) => (
                        <SelectItem key={launch.id} value={launch.id}>
                          {launch.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="px-2 pb-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[0.72rem] uppercase tracking-[0.32em] text-slate-400">
            Sistema
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild className="h-11 rounded-[1.15rem] px-3" tooltip={item.title}>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="group flex items-center gap-3 text-slate-300"
                      activeClassName="bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-[#8feeff] transition-colors group-hover:bg-white/10">
                        <item.icon className="h-4 w-4" />
                      </span>
                      {!collapsed && <span className="font-medium">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
        <Button
          variant="outline"
          className="w-full justify-start gap-3 border-white/10 bg-white/5 text-slate-200"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          {!collapsed && <span>{signingOut ? "Saindo..." : "Sair"}</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
