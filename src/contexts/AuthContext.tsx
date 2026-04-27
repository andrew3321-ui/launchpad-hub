import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import {
  getSupabaseConnectionConfig,
  subscribeToSupabaseConnection,
  supabase,
  type SupabaseConnectionConfig,
} from "@/integrations/supabase/client";

export interface AppProfile {
  approval_reviewed_at: string | null;
  approval_status: "approved" | "pending" | "rejected";
  email: string;
  full_name: string | null;
  is_admin: boolean;
  must_change_password: boolean;
  password_changed_at: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: AppProfile | null;
  profileReady: boolean;
  displayName: string | null;
  loading: boolean;
  connection: SupabaseConnectionConfig;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  completeInitialPasswordChange: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  profileReady: false,
  displayName: null,
  loading: true,
  connection: getSupabaseConnectionConfig(),
  signOut: async () => {},
  refreshProfile: async () => {},
  completeInitialPasswordChange: async () => {},
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

const getUserUiSignature = (currentUser: User | null) => {
  if (!currentUser) return "anonymous";

  const metadata = currentUser.user_metadata as Record<string, unknown> | undefined;
  const metadataName =
    (typeof metadata?.full_name === "string" && metadata.full_name.trim()) ||
    (typeof metadata?.name === "string" && metadata.name.trim()) ||
    "";

  return `${currentUser.id}|${currentUser.email ?? ""}|${metadataName}`;
};

const sameSessionIdentity = (currentSession: Session | null, nextSession: Session | null) => {
  if (!currentSession || !nextSession) return currentSession === nextSession;
  return getUserUiSignature(currentSession.user) === getUserUiSignature(nextSession.user);
};

const sameUserIdentity = (currentUser: User | null, nextUser: User | null) =>
  getUserUiSignature(currentUser) === getUserUiSignature(nextUser);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState(getSupabaseConnectionConfig());
  const [connectionVersion, setConnectionVersion] = useState(0);

  const deriveDisplayName = useCallback((currentUser: User | null, currentProfile: AppProfile | null) => {
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
  }, []);

  const loadProfile = useCallback(
    async (currentUser: User | null) => {
      if (!currentUser) {
        setProfile(null);
        setProfileReady(true);
        return;
      }

      setProfileReady(false);

      const { data, error } = await withTimeout(
        supabase
          .from("profiles")
          .select(
            "approval_reviewed_at, approval_status, email, full_name, is_admin, must_change_password, password_changed_at",
          )
          .eq("user_id", currentUser.id)
          .maybeSingle(),
        5000,
        "A consulta do perfil demorou demais para responder.",
      );

      if (error || !data) {
        console.warn("profile lookup skipped:", error?.message || "profile_not_found");
        setProfile({
          approval_reviewed_at: null,
          approval_status: "pending",
          email: currentUser.email || "",
          full_name: deriveDisplayName(currentUser, null),
          is_admin: false,
          must_change_password: true,
          password_changed_at: null,
        });
        setProfileReady(true);
        return;
      }

      setProfile({
        approval_reviewed_at: data.approval_reviewed_at,
        approval_status: data.approval_status as AppProfile["approval_status"],
        email: data.email,
        full_name: deriveDisplayName(currentUser, data as unknown as AppProfile),
        is_admin: data.is_admin,
        must_change_password: data.must_change_password,
        password_changed_at: data.password_changed_at,
      });
      setProfileReady(true);
    },
    [deriveDisplayName],
  );

  useEffect(() => {
    return subscribeToSupabaseConnection((nextConnection) => {
      setConnection(nextConnection);
      setConnectionVersion((current) => current + 1);
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setProfileReady(false);
    setSession(null);
    setUser(null);
    setProfile(null);

    const timeout = setTimeout(() => {
      if (mounted) {
        console.warn("Auth loading timeout - forcing loaded state");
        setLoading(false);
      }
    }, 5000);

    withTimeout(
      supabase.auth.getSession(),
      5000,
      "A sessão demorou demais para carregar.",
    )
      .then(({ data: { session: nextSession }, error }) => {
        if (!mounted) return;
        if (error) {
          console.error("getSession error:", error);
          setLoading(false);
          setProfileReady(true);
          return;
        }

        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        if (!nextSession?.user) {
          setProfileReady(true);
        }
        setLoading(false);
      })
      .catch((error) => {
        console.error("getSession catch:", error);
        if (mounted) {
          setLoading(false);
          setProfileReady(true);
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      const nextUser = nextSession?.user ?? null;

      setSession((currentSession) =>
        sameSessionIdentity(currentSession, nextSession) ? currentSession : nextSession,
      );
      setUser((currentUser) =>
        sameUserIdentity(currentUser, nextUser) ? currentUser : nextUser,
      );

      if (!nextSession?.user) {
        setProfile(null);
        setProfileReady(true);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [connectionVersion]);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setProfileReady(true);
      return;
    }

    let cancelled = false;

    const syncProfile = async () => {
      try {
        await loadProfile(user);
      } catch (error) {
        if (cancelled) return;
        console.warn("profile lookup failed:", error);
        setProfile({
          approval_reviewed_at: null,
          approval_status: "pending",
          email: user.email || "",
          full_name: deriveDisplayName(user, null),
          is_admin: false,
          must_change_password: true,
          password_changed_at: null,
        });
        setProfileReady(true);
      }
    };

    void syncProfile();

    const channel = supabase
      .channel(`profile-${user.id}-${connectionVersion}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          if (!cancelled) {
            void syncProfile();
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [connectionVersion, deriveDisplayName, loadProfile, user]);

  const refreshProfile = useCallback(async () => {
    await loadProfile(user);
  }, [loadProfile, user]);

  const completeInitialPasswordChange = useCallback(
    async (newPassword: string) => {
      const { error: authError } = await withTimeout(
        supabase.auth.updateUser({ password: newPassword }),
        8000,
        "A atualização da senha demorou demais para responder.",
      );

      if (authError) {
        throw authError;
      }

      await new Promise((resolve) => setTimeout(resolve, 350));
      await loadProfile(user);
    },
    [loadProfile, user],
  );

  const signOut = useCallback(async () => {
    setLoading(true);
    setProfileReady(false);
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
      setProfileReady(true);
      setLoading(false);
    }
  }, []);

  const displayName = useMemo(() => deriveDisplayName(user, profile), [deriveDisplayName, profile, user]);

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        profileReady,
        displayName,
        loading,
        connection,
        signOut,
        refreshProfile,
        completeInitialPasswordChange,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
