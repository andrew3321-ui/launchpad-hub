import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import { AuthAccessGate } from "@/components/AuthAccessGate";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, loading, profile, profileReady } = useAuth();

  if (loading || (session && !profileReady)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!profile || profile.must_change_password || profile.approval_status !== "approved") {
    return <AuthAccessGate />;
  }

  return <>{children}</>;
}
