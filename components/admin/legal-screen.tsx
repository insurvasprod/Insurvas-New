"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LEGAL_DOC_LABELS, LEGAL_DOC_TYPES, type LegalDocType } from "@/lib/legal/constants";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";

type Stat = {
  document_id: string;
  doc_type: string;
  version: number;
  title: string;
  label: string;
  is_draft: boolean;
  requires_reacceptance: boolean;
  eligible_users: number;
  accepted_count: number;
};

type Version = {
  id: string;
  doc_type: string;
  version: number;
  title: string;
  effective_date: string;
  change_summary: string | null;
  requires_reacceptance: boolean;
  is_draft: boolean;
  published_at: string;
};

type Lookup = {
  email: string;
  found: boolean;
  records: { id: string; doc_type: string; version: number; accepted_at: string; ip: string | null; context: string }[];
};

type Props = { canPublish: boolean; stats: Stat[]; versions: Version[]; lookup: Lookup | null };

export function LegalScreen({ canPublish, stats, versions, lookup }: Props) {
  const router = useRouter();
  const [publishing, setPublishing] = useState(false);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(lookup?.email ?? "");
  const [form, setForm] = useState({
    docType: "tos" as LegalDocType,
    title: "Terms of Service",
    content: "",
    effectiveDate: new Date().toISOString().slice(0, 10),
    changeSummary: "",
    requiresReacceptance: true,
  });

  async function publish() {
    setPublishing(true);
    const response = await fetch("/api/admin/legal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish", ...form }),
    });
    const body = await response.json().catch(() => null);
    setPublishing(false);

    if (!response.ok) {
      toast.error(body?.error ?? "Could not publish");
      return;
    }

    toast.success(
      form.requiresReacceptance
        ? `Published v${body.version}. Every user will be asked to accept it on their next request.`
        : `Published v${body.version}. Nobody is interrupted.`,
    );
    setOpen(false);
    setForm({ ...form, content: "", changeSummary: "" });
    router.refresh();
  }

  async function clearReacceptance(documentId: string, title: string) {
    const reason = window.prompt(`Why is the re-acceptance requirement being cleared on ${title}?`);
    if (!reason || reason.trim().length < 5) {
      if (reason !== null) toast.error("Give a reason of at least 5 characters");
      return;
    }

    const response = await fetch("/api/admin/legal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_reacceptance", documentId, reason: reason.trim() }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      toast.error(body?.error ?? "Could not clear it");
      return;
    }

    toast.success("Cleared — nobody is blocked by this version any more.");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => {
          const rate = stat.eligible_users === 0 ? 0 : stat.accepted_count / stat.eligible_users;
          return (
            <Card key={stat.document_id}>
              <CardContent className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <p className="text-2xl font-bold">
                      v{stat.version}{" "}
                      <span className="text-base font-normal text-muted-foreground">
                        · {(rate * 100).toFixed(0)}% accepted
                      </span>
                    </p>
                  </div>
                  {stat.is_draft && (
                    <Badge variant="outline" className="border-transparent bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
                      Draft
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {stat.accepted_count} of {stat.eligible_users} active users
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Link
                    href={`/legal/${stat.doc_type}?v=${stat.version}`}
                    target="_blank"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-600)] underline"
                  >
                    Read it <ExternalLink className="size-3" />
                  </Link>
                  {canPublish && stat.requires_reacceptance && rate < 1 && (
                    <button
                      type="button"
                      onClick={() => clearReacceptance(stat.document_id, stat.title)}
                      className="text-xs font-medium text-muted-foreground underline"
                      title="Stops this version blocking anyone. Use if it was published by mistake."
                    >
                      Stop requiring acceptance
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {stats.length === 0 && (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="text-sm text-muted-foreground">
              No legal documents have been published. Signup is blocked until at least a Terms of
              Service and a Privacy Policy exist — nobody can be asked to agree to a document that
              does not exist.
            </CardContent>
          </Card>
        )}
      </div>

      {canPublish && (
        <div>
          <Button onClick={() => setOpen(true)}>Publish a new version</Button>
        </div>
      )}

      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">
            Look up a user&apos;s acceptance history
          </h2>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              router.push(`/admin/legal?user=${encodeURIComponent(email.trim())}`);
            }}
          >
            <Input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="user@example.com"
              className="max-w-sm"
            />
            <Button type="submit" variant="outline">
              <Search className="size-4" /> Look up
            </Button>
          </form>

          {lookup && !lookup.found && (
            <p className="text-sm text-muted-foreground">No user with that email address.</p>
          )}

          {lookup?.found && lookup.records.length === 0 && (
            <p className="text-sm text-muted-foreground">
              That user exists but has accepted nothing. They signed up before acceptance was
              recorded, or their signup did not complete.
            </p>
          )}

          {lookup?.found && lookup.records.length > 0 && (
            <div className={tableShell}>
              <Table>
                <TableHeader>
                  <TableRow className={tableHeaderRow}>
                    <TableHead className={tableHeadCell}>Document</TableHead>
                    <TableHead className={tableHeadCell}>Version</TableHead>
                    <TableHead className={tableHeadCell}>Accepted</TableHead>
                    <TableHead className={tableHeadCell}>Where</TableHead>
                    <TableHead className={tableHeadCell}>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lookup.records.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">
                        {LEGAL_DOC_LABELS[record.doc_type as LegalDocType]}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/legal/${record.doc_type}?v=${record.version}`}
                          target="_blank"
                          className="text-[var(--brand-600)] underline"
                        >
                          v{record.version}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {new Date(record.accepted_at).toLocaleString()}
                      </TableCell>
                      <TableCell>{record.context === "signup" ? "At signup" : "Re-acceptance"}</TableCell>
                      <TableCell className="font-mono text-xs">{record.ip ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className={tableShell}>
        <Table>
          <TableHeader>
            <TableRow className={tableHeaderRow}>
              <TableHead className={tableHeadCell}>Document</TableHead>
              <TableHead className={tableHeadCell}>Version</TableHead>
              <TableHead className={tableHeadCell}>Effective</TableHead>
              <TableHead className={tableHeadCell}>Material</TableHead>
              <TableHead className={tableHeadCell}>What changed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  Nothing published yet.
                </TableCell>
              </TableRow>
            ) : (
              versions.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">
                    {LEGAL_DOC_LABELS[doc.doc_type as LegalDocType]}
                    {doc.is_draft && <span className="ml-2 text-xs text-[var(--color-warning)]">draft</span>}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/legal/${doc.doc_type}?v=${doc.version}`}
                      target="_blank"
                      className="text-[var(--brand-600)] underline"
                    >
                      v{doc.version}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {new Date(doc.effective_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{doc.requires_reacceptance ? "Yes" : "No"}</TableCell>
                  <TableCell className="max-w-md text-sm text-muted-foreground">
                    {doc.change_summary ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Publish a new version</DialogTitle>
            <DialogDescription>
              The version number is allocated when you publish. Older versions stay readable
              forever — that is what makes an acceptance record mean anything.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="docType">Document</Label>
                <select
                  id="docType"
                  value={form.docType}
                  onChange={(event) => {
                    const docType = event.target.value as LegalDocType;
                    setForm({ ...form, docType, title: LEGAL_DOC_LABELS[docType] });
                  }}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {LEGAL_DOC_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {LEGAL_DOC_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="effectiveDate">Effective date</Label>
                <Input
                  id="effectiveDate"
                  type="date"
                  value={form.effectiveDate}
                  onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </div>

            <div className="space-1.5 space-y-1.5">
              <Label htmlFor="content">Text (markdown: # headings, - bullets, **bold**)</Label>
              <textarea
                id="content"
                value={form.content}
                onChange={(event) => setForm({ ...form, content: event.target.value })}
                rows={12}
                className="w-full rounded-md border border-input bg-transparent p-3 font-mono text-xs"
                placeholder="# Terms of Service&#10;&#10;## 1. ..."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="changeSummary">What changed (shown to users on the acceptance screen)</Label>
              <Input
                id="changeSummary"
                value={form.changeSummary}
                onChange={(event) => setForm({ ...form, changeSummary: event.target.value })}
                placeholder="Clarified the refund policy and added a data retention period."
              />
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
              <input
                type="checkbox"
                checked={form.requiresReacceptance}
                onChange={(event) => setForm({ ...form, requiresReacceptance: event.target.checked })}
                className="mt-0.5 size-4 accent-[var(--brand-600)]"
              />
              <span>
                <span className="font-medium">This is a material change.</span> Every user is blocked
                from the product until they accept it. Leave unticked for a typo fix — interrupting
                every customer over a comma teaches them to click through without reading.
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={publishing}>
              Cancel
            </Button>
            <Button onClick={publish} disabled={publishing || form.content.trim().length < 50}>
              {publishing ? "Publishing…" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
