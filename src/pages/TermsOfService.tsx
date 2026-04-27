import { LegalDocumentPage } from "@/components/LegalDocumentPage";
import termsMarkdown from "../../docs/termos-de-servico.md?raw";

export default function TermsOfService() {
  return (
    <LegalDocumentPage
      title="Termos de Serviço"
      documentLabel="Condições de uso da plataforma"
      markdown={termsMarkdown}
    />
  );
}
