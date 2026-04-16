import { ArrowUpRight, Bot, RadioTower, Workflow } from "lucide-react";
import { MegafoneLogo } from "@/components/MegafoneLogo";

interface AuthShowcaseProps {
  eyebrow?: string;
  title?: string;
  description?: string;
}

const highlights = [
  {
    icon: RadioTower,
    title: "Bases conectadas",
    description: "Centralize ActiveCampaign, ManyChat e UChat em um ?nico cockpit.",
  },
  {
    icon: Workflow,
    title: "Tratamento autom?tico",
    description: "Padronize telefones, mescle duplicados e acompanhe tudo em logs claros.",
  },
  {
    icon: Bot,
    title: "Opera??o previsivel",
    description: "Transforme fluxos de lan?amento em um processo repet?vel e escal?vel.",
  },
];

export function AuthShowcase({
  eyebrow = "Megafone Digital",
  title = "Quem tem um Megafone n?o precisa gritar.",
  description = "Um painel feito para amplificar sua opera??o, acelerar lan?amentos e organizar contatos com a mesma energia visual da marca.",
}: AuthShowcaseProps) {
  return (
    <section className="brand-card brand-panel relative overflow-hidden p-6 sm:p-8">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#39d5ff] to-transparent opacity-70" />
      <div className="grid gap-8 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="relative z-10 space-y-6">
          <MegafoneLogo />

          <div className="space-y-4">
            <p className="brand-kicker">{eyebrow}</p>
            <h2 className="font-display text-3xl font-semibold leading-[1.05] text-white sm:text-4xl">
              {title.split("Megafone").length > 1 ? (
                <>
                  Quem tem um <span className="text-[#a9f0ff]">Megafone</span>
                  <br />
                  n?o precisa gritar.
                </>
              ) : (
                title
              )}
            </h2>
            <p className="max-w-xl text-sm leading-7 text-slate-300 sm:text-base">{description}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {highlights.map((item) => (
              <article
                key={item.title}
                className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4 shadow-[0_16px_40px_rgba(3,12,28,0.24)] backdrop-blur-xl"
              >
                <item.icon className="mb-3 h-5 w-5 text-[#39d5ff]" />
                <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-xs leading-6 text-slate-300">{item.description}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="relative min-h-[340px] overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_20%_20%,rgba(57,213,255,0.28),transparent_42%),linear-gradient(180deg,rgba(11,32,65,0.92),rgba(4,13,28,0.98))] p-4 shadow-[0_30px_80px_rgba(2,8,20,0.55)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(154,236,255,0.25),transparent_50%)]" />
          <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-[#08172e]/75 px-3 py-1 text-[0.68rem] uppercase tracking-[0.32em] text-[#91ecff] backdrop-blur-xl">
            Efeito Megafone
            <ArrowUpRight className="h-3.5 w-3.5" />
          </div>
          <img
            src="/megafone-astronaut.webp"
            alt="Astronauta da Megafone"
            className="absolute bottom-0 right-0 h-full w-full object-contain object-bottom"
          />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#051020] via-[#051020]/70 to-transparent" />
        </div>
      </div>
    </section>
  );
}
