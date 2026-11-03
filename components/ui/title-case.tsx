import { Children, cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";

import { titleCase } from "@/lib/format/titleCase";

/**
 * Title Case on the text of a label, tab, button or title (lib/format/titleCase.ts). Plain strings
 * and fragments are converted; icons and other elements are left as they are, so a button's icon
 * and a chip inside a tab keep working.
 */
export function titleCaseNode(node: ReactNode): ReactNode {
  if (typeof node === "string") return titleCase(node);
  if (Array.isArray(node)) return Children.map(node, (child) => titleCaseNode(child));
  if (isValidElement(node) && node.type === Fragment) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    return cloneElement(element, undefined, titleCaseNode(element.props.children));
  }
  return node;
}

/** For `asChild` (a Link drawn as a button): the one child keeps its element, its text converted. */
export function titleCaseChild(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return titleCaseNode(node);
  const element = node as ReactElement<{ children?: ReactNode }>;
  return cloneElement(element, undefined, titleCaseNode(element.props.children));
}
