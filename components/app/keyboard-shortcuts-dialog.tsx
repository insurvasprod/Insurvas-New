"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * What the account menu's "Keyboard shortcuts" row opens.
 *
 * Every row here is wired in the top bar (`TopBarShell`) — this list is a description of that code,
 * not a wish list. A shortcut added there is added here, and one taken away is taken away here.
 */
const SHORTCUTS: Array<{ keys: string[][]; action: string; where: string }> = [
  { keys: [["/"]], action: "Search", where: "Anywhere you are not typing" },
  { keys: [["⌘", "K"], ["Ctrl", "K"]], action: "Search", where: "Anywhere, even inside a field" },
  { keys: [["↑"], ["↓"]], action: "Move through search results", where: "While typing a search" },
  { keys: [["J"], ["K"]], action: "Next and previous row", where: "In search results, notifications, alerts and the alert centre, once a row has focus" },
  { keys: [["↵"]], action: "Open the highlighted row", where: "Search results and lists" },
  { keys: [["Esc"]], action: "Close the open menu or search", where: "Anywhere" },
];

function Keys({ keys }: { keys: string[][] }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {keys.map((combo, index) => (
        <span key={combo.join("+")} className="inline-flex items-center gap-1">
          {index > 0 && <span className="text-xs text-[var(--muted)]">or</span>}
          {combo.map((key) => (
            <kbd key={key} className="inline-flex min-w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-alt)] px-1.5 py-0.5 font-mono text-xs text-[var(--ink)]">
              {key}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

export function KeyboardShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Slash to search, J and K to move. None of them fire while you are typing in a field, except ⌘K.</DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {SHORTCUTS.map((shortcut) => (
            <div key={`${shortcut.action}-${shortcut.keys.flat().join("")}`} className="flex items-start justify-between gap-4 py-2.5">
              <dt className="min-w-0">
                <span className="block text-sm text-[var(--ink)]">{shortcut.action}</span>
                <span className="block text-xs text-[var(--muted)]">{shortcut.where}</span>
              </dt>
              <dd className="shrink-0"><Keys keys={shortcut.keys} /></dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
