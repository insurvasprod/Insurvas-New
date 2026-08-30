// SA-5.4 · A deliberately small markdown subset for stored legal text.
//
// Headings, paragraphs, bold and bullets — parsed into structure rather than into HTML. Legal text
// is authored by an admin through a form, and piping that into dangerouslySetInnerHTML would make
// the publish screen a stored-XSS hole aimed at every customer who reads the terms. No markdown
// library is pulled in for six constructs.

export type Block =
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

export function parseLegalMarkdown(content: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: "list", items: list });
    list = [];
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (const raw of content.split("\n")) {
    const line = raw.trim();

    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "heading", level: 2, text: line.slice(3) });
      continue;
    }
    if (line.startsWith("# ")) {
      flush();
      blocks.push({ kind: "heading", level: 1, text: line.slice(2) });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      list.push(line.slice(2));
      continue;
    }

    // A continuation line of a bullet, not a new paragraph — the seeded documents wrap them.
    if (list.length > 0) list[list.length - 1] += ` ${line}`;
    else paragraph.push(line);
  }

  flush();
  return blocks;
}
