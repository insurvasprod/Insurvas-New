// SA-5.4 · Renders stored legal text. The parsing lives in lib/legal/markdown.ts; this only draws.

import { parseLegalMarkdown } from "@/lib/legal/markdown";

/** **bold** only. Everything else stays literal text, which is the safe default for legal prose. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

export function LegalDocumentBody({ content, className }: { content: string; className?: string }) {
  const blocks = parseLegalMarkdown(content);

  return (
    <div className={`space-y-4 text-sm leading-relaxed text-[var(--color-text)] ${className ?? ""}`}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return block.level === 1 ? (
            <h1 key={index} className="text-2xl font-extrabold tracking-tight">
              <Inline text={block.text} />
            </h1>
          ) : (
            <h2 key={index} className="pt-2 text-lg font-bold tracking-tight">
              <Inline text={block.text} />
            </h2>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={index} className="list-disc space-y-1.5 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            <Inline text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
