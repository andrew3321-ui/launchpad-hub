import {
  LayoutDashboard,
  Rocket,
  Radio,
  GitBranch,
  Users,
  ListOrdered,
  FileText,
  LogOut,
  FolderOpen,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { useProject } from "@/contexts/ProjectContext";
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
import { Button } from "@/components/ui/button";

const menuItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Projetos", url: "/projects", icon: FolderOpen },
  { title: "Lançamentos", url: "/launches", icon: Rocket },
  { title: "Fontes", url: "/sources", icon: Radio },
  { title: "Regras", url: "/rules", icon: GitBranch },
  { title: "Leads", url: "/leads", icon: Users },
  { title: "Fila", url: "/queue", icon: ListOrdered },
  { title: "Logs", url: "/logs", icon: FileText },
];

export function AppSidebar() {
  const { profile, signOut } = useAuth();
  const { projects, activeProject, setActiveProject } = useProject();
  const { launches, activeLaunch, setActiveLaunch } = useLaunch();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4 space-y-3">
        {!collapsed && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Rocket className="h-4 w-4" />
              </div>
              <span className="font-bold text-lg">Launch Hub</span>
            </div>
            <div className="text-sm text-muted-foreground truncate">
              {profile?.full_name || "Usuário"}
            </div>

            {/* Project selector */}
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground font-medium">Projeto</span>
              <Select
                value={activeProject?.id || ""}
                onValueChange={(id) => {
                  const p = projects.find((p) => p.id === id);
                  setActiveProject(p || null);
                }}
              >
                <SelectTrigger className="w-full h-9 text-sm">
                  <SelectValue placeholder="Selecionar projeto" />
                </SelectTrigger>
                <SelectContent>
                  {projects.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Nenhum projeto
                    </div>
                  ) : (
                    projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Launch selector */}
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground font-medium">Lançamento</span>
              <Select
                value={activeLaunch?.id || ""}
                onValueChange={(id) => {
                  const l = launches.find((l) => l.id === id);
                  setActiveLaunch(l || null);
                }}
                disabled={!activeProject}
              >
                <SelectTrigger className="w-full h-9 text-sm">
                  <SelectValue placeholder={activeProject ? "Selecionar lançamento" : "Selecione um projeto"} />
                </SelectTrigger>
                <SelectContent>
                  {launches.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Nenhum lançamento
                    </div>
                  ) : (
                    launches.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    >
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
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
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Sair</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
