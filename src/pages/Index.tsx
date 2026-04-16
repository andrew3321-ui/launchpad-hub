import { Link } from "react-router-dom";
import { ArrowUpRight, Orbit, RadioTower, Sparkles, Users } from "lucide-react";
import { SchemaSetupCard } from "@/components/SchemaSetupCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useLaunch } from "@/contexts/LaunchContext";

const operationalCards = [
  {
    icon: RadioTower,
    label: "Fontes conectadas",
    description: "Configure ActiveCampaign, ManyChat e UChat no mesmo ambiente visual.",
  },
  {
    icon: Orbit,
    label: "Tratamento automatico",
    description: "Padronize numeros, mescle duplicados e acompanhe tudo em tempo real.",
  },
  {
    icon: Users,
    label: "Base tratada",
    description: "Use o painel como cockpit da operacao de leads e amplificacao digital.",
  },
];

export default function Dashboard() {
  const { connection } = useAuth();
  const { launches, activeLaunch } = useLaunch();

  return (
    <div className="space-y-6">
      <section className="brand-grid-surface overflow-hidden p-6 sm:p-8">
        <div className="grid gap-8 xl:grid-cols-[1.18fr_0.82fr]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="brand-chip border-white/10 bg-white/5 text-[#aef4ff]">
                <Sparkles className="h-3.5 w-3.5" />
                Megafone Digital
              </span>
              <span className="brand-chip border-white/10 bg-white/5 text-slate-200">
                Supabase {connection.projectRef}
              </span>
            </div>

            <div className="space-y-4">
              <h2 className="max-w-4xl text-balance font-display text-4xl font-semibold leading-[1.02] text-white sm:text-5xl xl:text-6xl">
                Quem tem um <span className="text-[#a9f0ff]">Megafone</span> nao precisa gritar.
              </h2>
              <p className="max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                Centralize suas bases, deixe o tratamento de contatos no automatico e transforme sua operacao digital
                em um fluxo mais previsivel, escalavel e alinhado com a marca Megafone.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/sources">
                  Conectar plataformas
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/rules">Ajustar regras de tratamento</Link>
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {operationalCards.map((item) => (
                <article
                  key={item.label}
                  className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 shadow-[0_20px_50px_rgba(3,10,24,0.18)]"
                >
                  <item.icon className="mb-4 h-5 w-5 text-[#39d5ff]" />
                  <h3 className="text-sm font-semibold text-white">{item.label}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="brand-astronaut-card relative min-h-[360px] rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(57,213,255,0.28),transparent_45%),linear-gradient(180deg,rgba(9,24,46,0.9),rgba(5,14,29,0.96))] p-5 shadow-[0_28px_80px_rgba(3,9,21,0.46)]">
            <img
              src="/megafone-astronaut.webp"
              alt="Astronauta Megafone"
              className="brand-astronaut-image absolute bottom-0 right-0 h-full w-full object-contain object-bottom"
            />
            <div className="absolute inset-x-0 bottom-0 rounded-b-[2rem] bg-gradient-to-t from-[#051020] via-[#051020]/85 to-transparent p-5 pt-20">
              <p className="brand-kicker">Operacao em orbita</p>
              <h3 className="mt-2 font-display text-2xl font-semibold text-white">
                {activeLaunch ? activeLaunch.name : "Selecione um lancamento para amplificar"}
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                {activeLaunch
                  ? "Esse lancamento ja pode receber conexoes, regras e observabilidade com a nova identidade visual."
                  : "Crie ou escolha um lancamento para ativar a cabine principal do sistema."}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="brand-card border-white/10 bg-[linear-gradient(180deg,rgba(8,23,46,0.92),rgba(4,12,24,0.84))]">
          <CardHeader>
            <CardTitle className="text-white">Panorama rapido</CardTitle>
            <CardDescription className="text-slate-300">
              Um resumo do ambiente atual enquanto voce constroi a operacao.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-400">Lancamentos mapeados</p>
              <p className="mt-3 font-display text-4xl font-semibold text-white">{launches.length}</p>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-400">Backend ativo</p>
              <p className="mt-3 break-all text-sm font-semibold text-[#aef4ff]">{connection.projectRef}</p>
            </div>
          </CardContent>
        </Card>

        <SchemaSetupCard
          title="Schema do backend"
          description="Continue usando esse card para validar rapidamente se o banco conectado ja recebeu tudo o que o app precisa."
        />
      </div>
    </div>
  );
}
