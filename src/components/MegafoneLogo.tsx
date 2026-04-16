import { cn } from "@/lib/utils";

interface MegafoneLogoProps {
  compact: boolean;
  className: string;
  showSubtitle: boolean;
}

export function MegafoneLogo({ compact = false, className, showSubtitle = true }: MegafoneLogoProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-[#041223] shadow-[0_0_0_1px_rgba(57,213,255,0.08),0_16px_40px_rgba(4,13,28,0.45)]">
        <img src="/megafone-mark.webp" alt="Megafone Digital" className="h-7 w-7 object-contain" />
      </div>

      {!compact && (
        <div className="min-w-0">
          <p className="font-display text-base font-semibold uppercase tracking-[0.28em] text-white">Megafone</p>
          {showSubtitle && (
            <p className="text-[0.68rem] font-medium uppercase tracking-[0.42em] text-[#39d5ff]/80">Digital</p>
          )}
        </div>
      )}
    </div>
  );
}
