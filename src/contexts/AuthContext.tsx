import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import {
  getSupabaseConnectionConfig,
  subscribeToSupabaseConnection,
  supabase,
  type SupabaseConnectionConfig,
} from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: { full_name: string | null } | null;
  displayName: string | null;
  loading: boolean;
  connection: SupabaseConnectionConfig;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  displayName: null,
  loading: true,
  connection: getSupabaseConnectionConfig(),
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const withTimeout = async <T,>(promise: PromiseLike<T>, timeoutMs: number, message: string) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const clearStoredSupabaseSessions = () => {
  const keysToRemove: string[] = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;

    if (key.startsWith("sb-") && (key.includes("auth-token") || key.includes("code-verifier"))) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<{ full_name: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState(getSupabaseConnectionConfig());
  const [connectionVersion, setConnectionVersion] = useState(0);

  const deriveDisplayName = (currentUser: User | null, currentProfile: { full_name: string | null } | null) => {
    const profileName = currentProfile?.full_name?.trim();
    if (profileName) return profileName;

    const metadata = currentUser?.user_metadata as Record<string, unknown> | undefined;
    const metadataName =
      (typeof metadata?.full_name === "string" && metadata.full_name.trim()) ||
      (typeof metadata?.name === "string" && metadata.name.trim()) ||
      null;

    if (metadataName) return metadataName;

    const emailName = currentUser?.email?.split("@")[0]?.trim() || null;
    return emailName || null;
  };

  useEffect(() => {
    return subscribeToSupabaseConnection((nextConnection) => {
      setConnection(nextConnection);
      setConnectionVersion((current) => current + 1);
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setSession(null);
    setUser(null);
    setProfile(null);

    // Safety timeout - never stay loading forever
    const timeout = setTimeout(() => {
      if (mounted) {
        console.warn("Auth loading timeout - forcing loaded state");
        setLoading(false);
      }
    }, 5000);

    // Get initial session
    withTimeout(
      supabase.auth.getSession(),
      5000,
      "A sessao demorou demais para carregar.",
    )
      .then(({ data: { session }, error }) => {
        if (!mounted) return;
        if (error) {
          console.error("getSession error:", error);
          setLoading(false);
          return;
        }

        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      })
      .catch((err) => {
        console.error("getSession catch:", err);
        if (mounted) setLoading(false);
      });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        setSession(session);
        setUser(session?.user ?? null);
        if (!session?.user) {
          setProfile(null);
        }
        setLoading(false);
      },
    );

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [connectionVersion]);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }

    let cancelled = false;

    const loadProfile = async () => {
      const { data, error } = await withTimeout(
        supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", user.id)
          .single(),
        5000,
        "A consulta do perfil demorou demais para responder.",
      );

      if (cancelled) return;

      if (error) {
        console.warn("profile lookup skipped:", error.message);
        setProfile({ full_name: deriveDisplayName(user, null) });
        return;
      }

      setProfile({ full_name: deriveDisplayName(user, data) });
    };

    loadProfile().catch((error) => {
      if (cancelled) return;
      console.warn("profile lookup failed:", error);
      setProfile({ full_name: deriveDisplayName(user, null) });
    });

    return () => {
      cancelled = true;
    };
  }, [user, connectionVersion]);

  const signOut = async () => {
    setLoading(true);
    setSession(null);
    setUser(null);
    setProfile(null);

    try {
      await withTimeout(
        supabase.auth.signOut({ scope: "local" }),
        4000,
        "O logout demorou demais para responder.",
      );
    } catch (error) {
      console.warn("signOut fallback:", error);
    } finally {
      clearStoredSupabaseSessions();
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        displayName: deriveDisplayName(user, profile),
        loading,
        connection,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
