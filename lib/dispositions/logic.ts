import type { DispositionNode } from "./types";

export function nextNodeForAnswer(node: DispositionNode, optionKey: string | null) {
  if (node.node_type === "choice") return node.options.find((option) => option.option_key === optionKey)?.next_node_id ?? null;
  return node.next_node_id;
}

export function isTerminal(node: DispositionNode, optionKey: string | null) {
  return nextNodeForAnswer(node, optionKey) === null;
}

export function composeNote(fragments: string[]) {
  return fragments.map((fragment) => fragment.trim()).filter(Boolean).join(" ");
}
