import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

interface Launch {
  id: string;
  name: string;
}

interface LaunchContextType {
  launches: Launch[];
  activeLaunch: Launch | null;
  setActiveLaunch: (launch: Launch | null) => void;
  loading: boolean;
}

const LaunchContext = createContext<LaunchContextType>({
  launches: [],
  activeLaunch: null,
  setActiveLaunch: () => {},
  loading: true,
});

export const useLaunch = () => useContext(LaunchContext);

export function LaunchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [activeLaunch, setActiveLaunch] = useState<Launch | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLaunches([]);
      setActiveLaunch(null);
      setLoading(false);
      return;
    }

    const fetchLaunches = async () => {
      const { data } = await supabase
        .from("launches")
        .select("id, name")
        .order("created_at", { ascending: false });

      if (data) {
        setLaunches(data);
        if (!activeLaunch && data.length > 0) {
          setActiveLaunch(data[0]);
        }
      }
      setLoading(false);
    };

    fetchLaunches();
  }, [user]);

  return (
    <LaunchContext.Provider value={{ launches, activeLaunch, setActiveLaunch, loading }}>
      {children}
    </LaunchContext.Provider>
  );
}
