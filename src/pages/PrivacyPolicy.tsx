import { LegalDocumentPage } from "@/components/LegalDocumentPage";
import privacyMarkdown from "../../docs/politica-de-privacidade.md?raw";

export default function PrivacyPolicy() {
  return (
    <LegalDocumentPage
      title="Política de Privacidade"
      documentLabel="Privacidade e proteção de dados"
      markdown={privacyMarkdown}
    />
  );
}
