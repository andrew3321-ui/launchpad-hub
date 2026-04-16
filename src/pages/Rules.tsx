import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLaunch } from "@/contexts/LaunchContext";
import { useToast } from "@/hooks/use-toast";
import {
  defaultDedupeSettings,
  generatePhoneCandidates,
  mergePreferenceLabel,
  type DedupeSettings,
} from "@/lib/phoneNormalization";
import { supabase } from "@/integrations/supabase/client";
import { GitBranch, Loader2, Sparkles, Unplug } from "lucide-react";

function RuleRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export default function Rules() {
  const { activeLaunch } = useLaunch();
  const { toast } = useToast();

  const [settings, setSettings] = useState<DedupeSettings>(defaultDedupeSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [samplePhone, setSamplePhone] = useState("");

  useEffect(() => {
    const load = async () => {
      if (!activeLaunch) {
        setLoading(false);
        setSettings(defaultDedupeSettings);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from("launch_dedupe_settings")
        .select("*")
        .eq("launch_id", activeLaunch.id)
        .maybeSingle();

      if (error) {
        toast({ title: "Erro ao carregar regras", description: error.message, variant: "destructive" });
        setLoading(false);
        return;
      }

      if (!data) {
        setSettings(defaultDedupeSettings);
        setLoading(false);
        return;
      }

      setSettings({
        compareDigitsOnly: data.compare_digits_only,
        autoAddCountryCode: data.auto_add_country_code,
        defaultCountryCode: data.default_country_code,
        autoAddNinthDigit: data.auto_add_ninth_digit,
        mergeOnExactPhone: data.merge_on_exact_phone,
        mergeOnExactEmail: data.merge_on_exact_email,
        autoMergeDuplicates: data.auto_merge_duplicates,
        preferMostCompleteRecord: data.prefer_most_complete_record,
      });
      setLoading(false);
    };

    load();
  }, [activeLaunch, toast]);

  const phoneCandidates = useMemo(
    () => generatePhoneCandidates(samplePhone, settings),
    [samplePhone, settings],
  );

  const saveRules = async () => {
    if (!activeLaunch) return;

    setSaving(true);
    const { error } = await supabase.from("launch_dedupe_settings").upsert({
      launch_id: activeLaunch.id,
      compare_digits_only: settings.compareDigitsOnly,
      auto_add_country_code: settings.autoAddCountryCode,
      default_country_code: settings.defaultCountryCode,
      auto_add_ninth_digit: settings.autoAddNinthDigit,
      merge_on_exact_phone: settings.mergeOnExactPhone,
      merge_on_exact_email: settings.mergeOnExactEmail,
      auto_merge_duplicates: settings.autoMergeDuplicates,
      prefer_most_complete_record: settings.preferMostCompleteRecord,
    });

    if (error) {
      toast({ title: "Erro ao salvar regras", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Regras de deduplicação atualizadas" });
    }
    setSaving(false);
  };

  if (!activeLaunch) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <GitBranch className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Regras</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Selecione um lançamento</CardTitle>
            <CardDescription>
              Escolha um lançamento na barra lateral para definir as regras de deduplicação e merge.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <GitBranch className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Regras</h1>
          <p className="text-sm text-muted-foreground">
            Defina como o sistema vai reconhecer duplicatas e mesclar dados no lançamento{" "}
            <span className="font-medium text-foreground">{activeLaunch.name}</span>.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Normalização de telefone</CardTitle>
                <CardDescription>
                  Ajusta formatos diferentes antes de comparar contatos vindos de bases distintas.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <RuleRow
                  title="Comparar apenas os dígitos"
                  description="Ignora espaços, parênteses, hífens e outros caracteres na hora de deduplicar."
                  checked={settings.compareDigitsOnly}
                  onCheckedChange={(checked) => setSettings((current) => ({ ...current, compareDigitsOnly: checked }))}
                />
                <RuleRow
                  title="Adicionar +55 automaticamente"
                  description="Tenta casar números com e sem código do país brasileiro."
                  checked={settings.autoAddCountryCode}
                  onCheckedChange={(checked) => setSettings((current) => ({ ...current, autoAddCountryCode: checked }))}
                />
                <div className="space-y-2">
                  <Label htmlFor="country-code">Código do país padrão</Label>
                  <Input
                    id="country-code"
                    value={settings.defaultCountryCode}
                    onChange={(event) =>
                      setSettings((current) => ({ ...current, defaultCountryCode: event.target.value.replace(/\D/g, "") }))
                    }
                    placeholder="55"
                    className="max-w-[180px]"
                  />
                </div>
                <RuleRow
                  title="Tentar adicionar ou remover o nono dígito"
                  description="Ajuda a reconhecer contatos quando uma base salva 11999998888 e outra 1199998888."
                  checked={settings.autoAddNinthDigit}
                  onCheckedChange={(checked) => setSettings((current) => ({ ...current, autoAddNinthDigit: checked }))}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Critérios de merge</CardTitle>
                <CardDescription>
                  Quando duas entradas representam a mesma pessoa, o sistema pode unificar automaticamente os dados.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <RuleRow
                  title="Detectar duplicata por telefone normalizado"
                  description="Marca como mesmo contato quando os números baterem após os tratamentos acima."
                  checked={settings.mergeOnExactPhone}
                  onCheckedChange={(checked) => setSettings((current) => ({ ...current, mergeOnExactPhone: checked }))}
                />
                <RuleRow
                  title="Detectar duplicata por email exato"
                  description="Mescla automaticamente quando o email for idêntico, mesmo vindo de canais diferentes."
                  checked={settings.mergeOnExactEmail}
                  onCheckedChange={(checked) => setSettings((current) => ({ ...current, mergeOnExactEmail: checked }))}
                />
                <RuleRow
                  title="Mesclar duplicatas automaticamente"
                  description="Quando a duplicata for confirmada, consolida os dados sem mandar para triagem manual."
                  checked={settings.autoMergeDuplicates}
                  onCheckedChange={(checked) => setSettings((current) => ({ ...current, autoMergeDuplicates: checked }))}
                />
                <RuleRow
                  title="Priorizar o cadastro mais completo"
                  description="Prefere o registro com mais campos preenchidos ao escolher qual versão vira a principal."
                  checked={settings.preferMostCompleteRecord}
                  onCheckedChange={(checked) =>
                    setSettings((current) => ({ ...current, preferMostCompleteRecord: checked }))
                  }
                />
              </CardContent>
              <CardFooter className="justify-between gap-4">
                <p className="text-sm text-muted-foreground">{mergePreferenceLabel(settings.preferMostCompleteRecord)}</p>
                <Button onClick={saveRules} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar regras
                </Button>
              </CardFooter>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Preview de deduplicação
                </CardTitle>
                <CardDescription>
                  Teste um número real e veja quais variações vão entrar no comparador antes do merge.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sample-phone">Telefone de teste</Label>
                  <Input
                    id="sample-phone"
                    value={samplePhone}
                    onChange={(event) => setSamplePhone(event.target.value)}
                    placeholder="Ex: 11 99888-7766"
                  />
                </div>

                {samplePhone ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Variações geradas para busca de duplicatas</p>
                    <div className="flex flex-wrap gap-2">
                      {phoneCandidates.map((candidate) => (
                        <Badge key={candidate} variant="outline" className="font-mono">
                          {candidate}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    <Unplug className="mt-0.5 h-4 w-4" />
                    Digite um telefone para visualizar como o sistema vai tentar casar cadastros com ou sem +55 e nono dígito.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Comportamento esperado</CardTitle>
                <CardDescription>Resumo da automação que o backend vai seguir ao processar eventos.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Se dois contatos tiverem o mesmo email ou telefone normalizado, o sistema pode tratá-los como a mesma pessoa.
                </p>
                <p>
                  Quando houver campos faltando em uma base e presentes em outra, o merge tende a consolidar tudo em um cadastro único.
                </p>
                <p>
                  Com estas regras salvas, o próximo passo natural é aplicar esse critério dentro dos webhooks e da fila de processamento.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
