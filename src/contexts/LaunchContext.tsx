import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "./AuthContext";

interface Launch {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  created_at: string;
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

const ACTIVE_LAUNCH_STORAGE_KEY = "megafone-active-launch-id";

export function LaunchProvider({ children }: { children: ReactNode }) {
  const { user, session, loading: authLoading, profileReady } = useAuth();
  const { toast } = useToast();
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [activeLaunch, setActiveLaunchState] = useState<Launch | null>(null);
  const [loading, setLoading] = useState(true);

  const setActiveLaunch = useCallback((launch: Launch | null) => {
    setActiveLaunchState(launch);

    if (launch?.id) {
      localStorage.setItem(ACTIVE_LAUNCH_STORAGE_KEY, launch.id);
      return;
    }

    localStorage.removeItem(ACTIVE_LAUNCH_STORAGE_KEY);
  }, []);

  const fetchLaunches = useCallback(async () => {
    if (authLoading || (session && !profileReady)) {
      setLoading(true);
      return;
    }

    if (!session || !user) {
      setLaunches([]);
      setActiveLaunchState(null);
      localStorage.removeItem(ACTIVE_LAUNCH_STORAGE_KEY);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("launches")
      .select("id, name, slug, status, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      toast({
        title: "Erro ao atualizar lancamentos",
        description: error.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    if (data) {
      setLaunches(data);
      const storedLaunchId = localStorage.getItem(ACTIVE_LAUNCH_STORAGE_KEY);

      setActiveLaunchState((prev) => {
        const preferredId = prev?.id || storedLaunchId;

        if (preferredId) {
          const matchingLaunch = data.find((launch) => launch.id === preferredId);
          if (matchingLaunch) return matchingLaunch;
        }

        return data.length > 0 ? data[0] : null;
      });
    }

    setLoading(false);
  }, [authLoading, profileReady, session, toast, user]);

  useEffect(() => {
    void fetchLaunches();
  }, [fetchLaunches]);

  return (
    <LaunchContext.Provider
      value={{ launches, activeLaunch, setActiveLaunch, loading, refreshLaunches: fetchLaunches }}
    >
      {children}
    </LaunchContext.Provider>
  );
}
