import { Fragment, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: false,
    });
  } catch {
    return latex;
  }
}

function normalizeLatex(src: string): string {
  return src.replace(/\\\\([A-Za-z]+)/g, "\\$1");
}

function isUndelimitedLatexLine(line: string): boolean {
  const trimmed = line.trim();
  return /^\\/.test(trimmed) && /\\(?:frac|sqrt|sum|int|prod|lim|partial|nabla|text|mathrm|mathbf|Large|small|begin|end|left|right|over|cdot|times|alpha|beta|gamma|delta|sigma|theta|lambda|mu|pi|omega)/.test(trimmed);
}

function autoDelimit(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (isUndelimitedLatexLine(line)) return `$$${line.trim()}$$`;
      return line;
    })
    .join("\n");
}

function renderBoldAndLines(text: string, keyPrefix: string): ReactNode[] {
  const rendered: ReactNode[] = [];
  const lines = text.split("\n");
  lines.forEach((line, lineIdx) => {
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch) {
      rendered.push(
        <strong key={`${keyPrefix}-h-${lineIdx}`} className="block font-semibold text-gray-100 mt-2 mb-0.5">
          {headingMatch[2]}
        </strong>,
      );
    } else if (/^---+$/.test(line.trim())) {
      rendered.push(<hr key={`${keyPrefix}-hr-${lineIdx}`} className="border-surface-border my-2" />);
    } else {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      parts.forEach((part, pi) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          rendered.push(<strong key={`${keyPrefix}-b-${lineIdx}-${pi}`}>{part.slice(2, -2)}</strong>);
        } else if (part) {
          rendered.push(<Fragment key={`${keyPrefix}-t-${lineIdx}-${pi}`}>{part}</Fragment>);
        }
      });
    }
    if (lineIdx < lines.length - 1) rendered.push(<br key={`${keyPrefix}-br-${lineIdx}`} />);
  });
  return rendered;
}

export function renderRichText(text: string): ReactNode[] {
  if (!text) return [];
  const prepared = autoDelimit(text);
  const mathRe = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+\$)/g;
  const isMathToken = /^(\$\$[\s\S]*\$\$|\\\[[\s\S]*\\\]|\\\([\s\S]*\\\)|\$[^$\n]+\$)$/;
  const isBlock = (t: string) =>
    (t.startsWith("$$") && t.endsWith("$$")) || (t.startsWith("\\[") && t.endsWith("\\]"));
  const stripDelimiters = (t: string): string => {
    if (t.startsWith("$$") && t.endsWith("$$")) return t.slice(2, -2).trim();
    if (t.startsWith("\\[") && t.endsWith("\\]")) return t.slice(2, -2).trim();
    if (t.startsWith("$") && t.endsWith("$")) return t.slice(1, -1).trim();
    if (t.startsWith("\\(") && t.endsWith("\\)")) return t.slice(2, -2).trim();
    return t.trim();
  };

  const chunks = prepared.split(mathRe).filter(Boolean);
  const out: ReactNode[] = [];
  chunks.forEach((chunk, idx) => {
    if (isMathToken.test(chunk)) {
      const raw = normalizeLatex(stripDelimiters(chunk));
      if (!raw) return;
      const html = renderKatex(raw, isBlock(chunk));
      out.push(
        isBlock(chunk) ? (
          <div
            key={`math-block-${idx}`}
            className="math-block-rendered overflow-x-auto my-1"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <span
            key={`math-inline-${idx}`}
            className="math-inline-rendered"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ),
      );
      return;
    }
    out.push(...renderBoldAndLines(chunk, `txt-${idx}`));
  });
  return out;
}
