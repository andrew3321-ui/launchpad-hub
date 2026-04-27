import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { MegafoneLogo } from "@/components/MegafoneLogo";

interface LegalDocumentPageProps {
  title: string;
  documentLabel: string;
  markdown: string;
}

type Block =
  | { type: "h1"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    blocks.push({
      type: "paragraph",
      text: paragraphLines.join(" ").trim(),
    });
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push({
      type: "list",
      items: [...listItems],
    });
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h3", text: line.slice(4).trim() });
      continue;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h2", text: line.slice(3).trim() });
      continue;
    }

    if (line.startsWith("# ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h1", text: line.slice(2).trim() });
      continue;
    }

    if (line.startsWith("- ")) {
      flushParagraph();
      listItems.push(line.slice(2).trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|https?:\/\/\S+|[\w.+-]+@[\w.-]+\.\w+)/g);

  return tokens
    .filter(Boolean)
    .map((token, index) => {
      if (token.startsWith("**") && token.endsWith("**")) {
        return (
          <strong key={`${token}-${index}`} className="font-semibold text-white">
            {token.slice(2, -2)}
          </strong>
        );
      }

      if (/^https?:\/\/\S+$/i.test(token)) {
        return (
          <a
            key={`${token}-${index}`}
            href={token}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 break-all text-[#8feeff] underline decoration-white/20 underline-offset-4 hover:text-white"
          >
            {token}
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
        );
      }

      if (/^[\w.+-]+@[\w.-]+\.\w+$/i.test(token)) {
        return (
          <a
            key={`${token}-${index}`}
            href={`mailto:${token}`}
            className="break-all text-[#8feeff] underline decoration-white/20 underline-offset-4 hover:text-white"
          >
            {token}
          </a>
        );
      }

      return <span key={`${token}-${index}`}>{token}</span>;
    });
}

export function LegalDocumentPage({
  title,
  documentLabel,
  markdown,
}: LegalDocumentPageProps) {
  const blocks = parseMarkdown(markdown);

  return (
    <div className="brand-page min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            to="/login"
            className="brand-chip border-white/10 bg-white/5 text-slate-200 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar ao acesso
          </Link>

          <MegafoneLogo />
        </div>

        <section className="brand-grid-surface px-6 py-8 sm:px-8 sm:py-10">
          <div className="space-y-4">
            <p className="brand-kicker">{documentLabel}</p>
            <h1 className="max-w-4xl text-balance font-display text-4xl font-semibold leading-tight text-white sm:text-5xl">
              {title}
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              Documento público do Launch Hub para transparência operacional, privacidade e conformidade
              das integrações da Megafone Digital.
            </p>
          </div>
        </section>

        <article className="brand-card border-white/10 bg-[linear-gradient(180deg,rgba(8,24,47,0.94),rgba(6,17,34,0.92))] p-6 sm:p-8">
          <div className="space-y-6">
            {blocks.map((block, index) => {
              if (block.type === "h1") {
                return (
                  <h2 key={index} className="font-display text-3xl font-semibold text-white">
                    {renderInline(block.text)}
                  </h2>
                );
              }

              if (block.type === "h2") {
                return (
                  <h3
                    key={index}
                    className="border-t border-white/10 pt-6 font-display text-2xl font-semibold text-white"
                  >
                    {renderInline(block.text)}
                  </h3>
                );
              }

              if (block.type === "h3") {
                return (
                  <h4 key={index} className="font-display text-lg font-semibold text-[#aef4ff]">
                    {renderInline(block.text)}
                  </h4>
                );
              }

              if (block.type === "list") {
                return (
                  <ul key={index} className="space-y-3 pl-5 text-sm leading-7 text-slate-300 sm:text-base">
                    {block.items.map((item, itemIndex) => (
                      <li key={`${index}-${itemIndex}`} className="list-disc marker:text-[#39d5ff]">
                        {renderInline(item)}
                      </li>
                    ))}
                  </ul>
                );
              }

              return (
                <p key={index} className="text-sm leading-8 text-slate-300 sm:text-base">
                  {renderInline(block.text)}
                </p>
              );
            })}
          </div>
        </article>
      </div>
    </div>
  );
}
