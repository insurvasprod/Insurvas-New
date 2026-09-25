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

export function LegalDocumentBody({ content, className, title }: { content: string; className?: string; title?: string }) {
  const parsed = parseLegalMarkdown(content);
  // Stored documents often open with their own title as a heading. A page that already shows the
  // title as its h1 passes it here, so the words do not appear twice (and the page keeps one h1).
  const first = parsed[0];
  const blocks = title && first?.kind === "heading" && first.text.trim().toLowerCase() === title.trim().toLowerCase() ? parsed.slice(1) : parsed;

  return (
    <div className={`max-w-[68ch] text-base leading-normal tracking-[-0.02em] text-[var(--body)] ${className ?? ""}`}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return block.level === 1 ? (
            <h1 key={index} className="mb-3 mt-7 text-2xl font-semibold leading-[1.21] tracking-[-0.02em] text-foreground">
              <Inline text={block.text} />
            </h1>
          ) : (
            <h2 key={index} className="mb-3 mt-7 text-2xl font-semibold leading-[1.21] tracking-[-0.02em] text-foreground">
              <Inline text={block.text} />
            </h2>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={index} className="my-4 list-disc space-y-1.5 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="my-4">
            <Inline text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
