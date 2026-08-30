"use client";

import { useCallback, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ProductRow } from "@/lib/products/constants";
import type { TemplateRow } from "@/lib/templates/constants";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";
import { TemplateEditorDialog } from "./template-editor-dialog";

export function TemplatesTable({ initialTemplates, products }: { initialTemplates: TemplateRow[]; products: ProductRow[] }) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/templates");
    if (response.ok) setTemplates((await response.json()).templates);
  }, []);

  async function archive(template: TemplateRow, isActive: boolean) {
    setPendingId(template.id);
    const response = await fetch(`/api/admin/templates/${template.id}`, isActive ? {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: true }),
    } : { method: "DELETE" });
    setPendingId(null);
    if (!response.ok) { const body = await response.json().catch(() => null); toast.error(body?.error ?? "Could not update the template"); return; }
    toast.success(`${template.name} ${isActive ? "restored" : "archived"}`);
    refresh();
  }

  async function duplicate(template: TemplateRow) {
    setPendingId(template.id);
    const response = await fetch(`/api/admin/templates/${template.id}/duplicate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `${template.name} copy` }) });
    const body = await response.json().catch(() => null);
    setPendingId(null);
    if (!response.ok) { toast.error(body?.error ?? "Could not duplicate the template"); return; }
    toast.success(`${template.name} duplicated`);
    refresh();
  }

  const active = templates.filter((template) => template.is_active);
  const archived = templates.filter((template) => !template.is_active);
  const visible = showArchived ? templates : active;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-muted-foreground">{active.length} active{archived.length > 0 && ` · ${archived.length} archived`}</p>{archived.length > 0 && <Button variant="outline" size="sm" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide archived" : "Show archived"}</Button>}<div className="ml-auto"><Button size="sm" onClick={() => setCreating(true)}>New template</Button></div></div>
      <div className={tableShell}><Table><TableHeader><TableRow className={tableHeaderRow}><TableHead className={tableHeadCell}>Template</TableHead><TableHead className={tableHeadCell}>Product</TableHead><TableHead className={tableHeadCell}>Version</TableHead><TableHead className={tableHeadCell}>Contents</TableHead><TableHead className={`${tableHeadCell} w-10`} /></TableRow></TableHeader><TableBody>
        {visible.length === 0 && <TableRow><TableCell colSpan={5} className="h-20 text-center text-sm text-muted-foreground">No templates yet. Build the first starting workspace.</TableCell></TableRow>}
        {visible.map((template) => <TableRow key={template.id} className={!template.is_active ? "opacity-55" : undefined}><TableCell className="font-medium"><span className="flex items-center gap-2">{template.name}{!template.is_active && <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">Archived</Badge>}</span><p className="mt-1 max-w-[260px] truncate text-xs font-normal text-muted-foreground">{template.description ?? "No description"}</p></TableCell><TableCell>{template.product_name}<p className="text-xs text-muted-foreground"><code>{template.product_code}</code></p></TableCell><TableCell>v{template.version}</TableCell><TableCell className="text-sm text-muted-foreground">{template.fields.length} fields · {template.stages.length} stages · {template.form_definition.sections.length} form sections</TableCell><TableCell><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" disabled={pendingId === template.id}><MoreHorizontal /><span className="sr-only">Actions</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setEditing(template)}>Edit / new version</DropdownMenuItem><DropdownMenuItem onSelect={() => duplicate(template)}>Duplicate</DropdownMenuItem>{template.is_active ? <DropdownMenuItem variant="destructive" onSelect={() => archive(template, false)}>Archive</DropdownMenuItem> : <DropdownMenuItem onSelect={() => archive(template, true)}>Restore</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></TableCell></TableRow>)}
      </TableBody></Table></div>
      <TemplateEditorDialog key={`create-${creating}`} mode="create" open={creating} products={products} onClose={() => setCreating(false)} onSaved={refresh} />
      <TemplateEditorDialog key={`edit-${editing?.id ?? "none"}-${editing?.version ?? 0}`} mode="edit" open={editing !== null} template={editing} products={products} onClose={() => setEditing(null)} onSaved={refresh} />
    </div>
  );
}
