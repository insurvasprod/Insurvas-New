/**
 * Title Case for labels, tabs, buttons and titles (manager review 28 Oct §1.6, owner's yes on
 * 2026-10-29): "Primary State", "For an Agency", "Copy to My Agency". Helper text stays in sentence
 * case, so a string that reads as a sentence or a question is returned as it is.
 *
 * Words left alone: acronyms and mixed-case words (NPN, EIN, iPhone, CSV), anything with a digit,
 * "@", "/" or "." inside (emails, links, versions, "v1"). Small words stay lowercase unless they
 * start or end the label, or follow ":", "·", "—", "(" or "/".
 */
const SMALL = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "as", "at", "by", "in", "of", "off", "on", "per", "to", "up", "via", "vs"]);
/** "Set Up", "Sign In", "Turn Off": after these verbs the small word belongs to the verb. */
const PHRASAL = new Set(["set", "sign", "log", "turn", "check", "opt", "roll", "back", "pick", "look", "follow", "top", "add", "fill", "hand", "start"]);
const PARTICLE = new Set(["up", "in", "on", "off", "out", "back"]);

/** Reads as help text rather than a label: a full stop, or a question. */
function isSentence(text: string): boolean {
  const t = text.trim();
  return /[.?!]$/.test(t) || /\.\s/.test(t) || t.length > 72;
}

function capitalise(part: string): string {
  const i = part.search(/\p{L}/u);
  if (i < 0) return part;
  return part.slice(0, i) + part.charAt(i).toUpperCase() + part.slice(i + 1);
}

function leaveAlone(word: string): boolean {
  const core = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!core) return true;
  if (/[\d@/]/.test(core) || /\.\p{L}/u.test(core)) return true;
  // Any capital after the first letter: an acronym or a brand (NPN, iPhone, McDonald).
  return /\p{Lu}/u.test(core.slice(1));
}

export function titleCase(text: string): string {
  if (!text || isSentence(text)) return text;
  const tokens = text.split(/(\s+)/);
  const words = tokens.filter((token) => token.trim() !== "");
  const last = words[words.length - 1];
  let index = 0;
  let afterBreak = true;
  let previous = "";
  return tokens.map((token) => {
    if (token.trim() === "") return token;
    const word = token;
    const first = index === 0;
    const isLast = word === last && index === words.length - 1;
    index += 1;
    const forced = first || isLast || afterBreak;
    afterBreak = /[:·—(/]$/.test(word) || word === "·" || word === "—" || word === "–";
    const bare = word.toLowerCase().replace(/[^\p{L}]/gu, "");
    const phrasal = PARTICLE.has(bare) && PHRASAL.has(previous);
    previous = bare;
    if (leaveAlone(word)) return word;
    if (!forced && !phrasal && SMALL.has(bare) && !/^\(/.test(word)) return word.toLowerCase();
    return word.split("-").map((part) => capitalise(part)).join("-");
  }).join("");
}
