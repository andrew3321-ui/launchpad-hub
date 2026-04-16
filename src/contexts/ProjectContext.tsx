import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

interface Project {
  id: string;
  name: string;
  slug: string | null;
  status: string;
}

interface ProjectContextType {
  projects: Project[];
  activeProject: Project | null;
  setActiveProject: (project: Project | null) => void;
  loading: boolean;
  refreshProjects: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextType>({
  projects: [],
  activeProject: null,
  setActiveProject: () => {},
  loading: true,
  refreshProjects: async () => {},
});

export const useProject = () => useContext(ProjectContext);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    if (!user) {
      setProjects([]);
      setActiveProject(null);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("projects")
      .select("id, name, slug, status")
      .order("created_at", { ascending: false });

    if (data) {
      setProjects(data);
      setActiveProject((prev) => {
        if (prev && data.find((p) => p.id === prev.id)) {
          return data.find((p) => p.id === prev.id)!;
        }
        return data.length > 0 ? data[0] : null;
      });
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return (
    <ProjectContext.Provider
      value={{ projects, activeProject, setActiveProject, loading, refreshProjects: fetchProjects }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
