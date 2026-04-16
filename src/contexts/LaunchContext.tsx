import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";
import { useProject } from "./ProjectContext";

interface Launch {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  project_id: string | null;
}

interface LaunchContextType {
  launches: Launch[];
  activeLaunch: Launch | null;
  setActiveLaunch: (launch: Launch | null) => void;
  loading: boolean;
  refreshLaunches: () => Promise<void>;
}

const LaunchContext = createContext<LaunchContextType>({
  launches: [],
  activeLaunch: null,
  setActiveLaunch: () => {},
  loading: true,
  refreshLaunches: async () => {},
});

export const useLaunch = () => useContext(LaunchContext);

export function LaunchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { activeProject } = useProject();
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [activeLaunch, setActiveLaunch] = useState<Launch | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLaunches = useCallback(async () => {
    if (!user || !activeProject) {
      setLaunches([]);
      setActiveLaunch(null);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("launches")
        .select("id, name, slug, status, project_id")
        .eq("project_id", activeProject.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching launches:", error);
        return;
      }

      if (data) {
        setLaunches(data);
        setActiveLaunch((prev) => {
          if (prev && data.find((l) => l.id === prev.id)) {
            return data.find((l) => l.id === prev.id)!;
          }
          return data.length > 0 ? data[0] : null;
        });
      }
    } catch (err) {
      console.error("Error in fetchLaunches:", err);
    } finally {
      setLoading(false);
    }
  }, [user, activeProject]);

  useEffect(() => {
    setLoading(true);
    fetchLaunches();
  }, [fetchLaunches]);

  return (
    <LaunchContext.Provider
      value={{ launches, activeLaunch, setActiveLaunch, loading, refreshLaunches: fetchLaunches }}
    >
      {children}
    </LaunchContext.Provider>
  );
}
