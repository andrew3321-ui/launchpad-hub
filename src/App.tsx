import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { LaunchProvider } from "@/contexts/LaunchContext";
import { AuthGuard } from "@/components/AuthGuard";
import { AppLayout } from "@/components/AppLayout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Index from "./pages/Index";
import Projects from "./pages/Projects";
import Launches from "./pages/Launches";
import Sources from "./pages/Sources";
import Rules from "./pages/Rules";
import Leads from "./pages/Leads";
import Queue from "./pages/Queue";
import Logs from "./pages/Logs";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route
              element={
                <AuthGuard>
                  <ProjectProvider>
                    <LaunchProvider>
                      <AppLayout />
                    </LaunchProvider>
                  </ProjectProvider>
                </AuthGuard>
              }
            >
              <Route path="/" element={<Index />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/launches" element={<Launches />} />
              <Route path="/sources" element={<Sources />} />
              <Route path="/rules" element={<Rules />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/queue" element={<Queue />} />
              <Route path="/logs" element={<Logs />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
