"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkArrow } from "@/components/ui/link-arrow";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { SearchCommand } from "@/components/ui/search-command";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SettingsLayout, SettingsSaveBar } from "@/components/ui/settings-layout";
import { ThemeToggle } from "@/components/theme-toggle";

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-8">
      <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{note}</p>
      <div className="mt-6 flex flex-wrap items-center gap-4">{children}</div>
    </section>
  );
}

const SWATCHES = [
  "primary",
  "ink",
  "body",
  "muted",
  "canvas",
  "surface-alt",
  "success",
  "warning",
  "error",
  "info",
] as const;

const TYPE_SCALE = [
  { name: "hero · 56/600/-0.035em", className: "text-[56px] font-semibold leading-[1.02] tracking-[-0.035em]" },
  { name: "headline-lg · 40/600/-0.03em", className: "text-[40px] font-semibold leading-[1.08] tracking-[-0.03em]" },
  { name: "title-lg · 32/600/-0.025em", className: "text-[32px] font-semibold leading-[1.13] tracking-[-0.025em]" },
  { name: "title-md · 24/600/-0.02em", className: "text-2xl font-semibold leading-[1.21] tracking-[-0.02em]" },
  { name: "title-sm · 18/600/-0.015em", className: "text-lg font-semibold leading-[1.28] tracking-[-0.015em]" },
  { name: "body · 16/400/-0.02em", className: "text-base leading-normal tracking-[-0.02em]" },
  { name: "caption · 14/400/-0.02em", className: "text-sm leading-normal tracking-[-0.02em]" },
  { name: "legal · 12/400/-0.01em", className: "text-xs leading-normal tracking-[-0.01em]" },
] as const;

/**
 * What each token resolves to on this page, read after mount and again when the theme flips (the
 * toggle changes `data-theme` on <html>). Empty until then, so the server render shows token names.
 */
function useResolvedTokens(names: readonly string[]) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      setValues(Object.fromEntries(names.map((name) => [name, style.getPropertyValue(`--${name}`).trim()]).filter(([, value]) => value)));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => observer.disconnect();
  }, [names]);
  return values;
}

const TONES: StatusTone[] =["neutral", "good", "info", "warning", "danger", "action"];
const TONE_LABEL: Record<StatusTone, string> = {
  neutral: "Draft",
  good: "Active",
  info: "Verifying",
  warning: "Pending review",
  danger: "Past due",
  action: "Action needed",
};

export function PrimitivesShowcase() {
  const [pressed, setPressed] = useState<string | null>(null);
  const [section, setSection] = useState("agency-profile");
  const press = (label: string) => () => setPressed(label);
  const resolved = useResolvedTokens(SWATCHES);

  return (
    <main className="mx-auto w-full max-w-[1344px] px-4 py-10 sm:px-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
            Reference
          </div>
          <h1 className="mt-1.5 text-[32px] font-semibold leading-[1.13] tracking-[-0.025em]">Primitives</h1>
          <p className="mt-1.5 max-w-2xl text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            The tokens and controls every other page is assembled from. Nothing here is decorative.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <Section
        title="Colour"
        note="Named, not picked. Every swatch here resolves through a token, which is why the same page works in both themes."
      >
        <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-5">
          {SWATCHES.map((swatch) => (
            <div key={swatch}>
              <div
                className="h-14 rounded-lg border border-border"
                style={{ background: `var(--${swatch})` }}
                aria-hidden="true"
              />
              <div className="mt-2 text-xs font-semibold leading-normal tracking-[-0.01em] text-foreground">
                {swatch}
              </div>
              <div className="text-xs leading-normal tracking-[-0.01em] tabular-nums text-muted-foreground">
                {/* The value the token resolves to right now — read from the page, so it is true in
                    whichever theme (and whichever plane's overrides) is active, never a copied hex. */}
                {resolved[swatch] ?? `var(--${swatch})`}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Type"
        note="Eight steps and no more. A page that needs a ninth is a page that has not decided what it is about."
      >
        <div className="w-full">
          {TYPE_SCALE.map((step) => (
            <div key={step.name} className="flex items-baseline gap-6 border-t border-border py-3 first:border-t-0">
              <span className="w-48 shrink-0 text-xs leading-normal tracking-[-0.01em] tabular-nums text-muted-foreground">
                {step.name}
              </span>
              <span className={step.className}>The quick brown fox</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Button" note="One primary per view. Secondary is the calm companion; ghost is for toolbars and rows.">
        <Button onClick={press("Create lead")}>Create lead</Button>
        <Button variant="secondary" onClick={press("See a demo")}>See a demo</Button>
        <Button variant="outline" onClick={press("Export")}>Export</Button>
        <Button variant="ghost" onClick={press("Cancel")}>Cancel</Button>
        <Button variant="destructive" onClick={press("Suspend account")}>Suspend account</Button>
        <Button variant="link" onClick={press("View policy")}>View policy</Button>
        <Button disabled>Disabled</Button>
      </Section>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {pressed ? `Last pressed: ${pressed}` : "Press a control — this line reports it."}
      </p>

      <Section title="Button sizes" note="Heights stay as they were: this is a dense product and rows are the budget.">
        <Button size="lg" onClick={press("Large")}>Large</Button>
        <Button onClick={press("Default")}>Default</Button>
        <Button size="sm" onClick={press("Small")}>Small</Button>
        <Button size="xs" onClick={press("XS")}>XS</Button>
        <Button size="icon" aria-label="More" onClick={press("More")}>…</Button>
      </Section>

      <Section title="LinkArrow" note="The secondary action. Ink text, an arrow that slides on hover, and a label that names the destination.">
        <LinkArrow href="#">See how approvals work</LinkArrow>
        <LinkArrow href="#">Read the integration guide</LinkArrow>
      </Section>

      <Section title="Badge" note="Labels a fact — a plan, a role, a count. Accent is for automation moments and stays rare.">
        <Badge>Pro</Badge>
        <Badge variant="secondary">Agency</Badge>
        <Badge variant="accent">Automated</Badge>
        <Badge variant="outline">Draft</Badge>
        <Badge variant="destructive">Over limit</Badge>
      </Section>

      <Section title="StatusChip" note="Reports a state that changes. Tone says what it means; the dot carries it where hue alone will not.">
        {TONES.map((tone) => (
          <StatusChip key={tone} tone={tone} dot>
            {TONE_LABEL[tone]}
          </StatusChip>
        ))}
      </Section>

      <Section title="SearchCommand" note="A utility control, never a call to action: muted band, muted text, no fill.">
        <SearchCommand
          placeholder="Search leads, policies, agents"
          label="Search the workspace"
          onClick={press("SearchCommand")}
        />
      </Section>

      <Section title="Input, Label, Select" note="A control's edge is stronger than a divider, and every field has a visible label.">
        <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="ds-agency">Agency name</Label>
            <Input id="ds-agency" defaultValue="Northeast Benefits" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ds-npn">NPN</Label>
            <Input id="ds-npn" defaultValue="48-221" aria-invalid />
            <p className="text-xs text-[var(--error)]">An NPN is 8 to 10 digits.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ds-email">Work email</Label>
            <Input id="ds-email" placeholder="agent@agency.com" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ds-carrier">Carrier</Label>
            <Select>
              <SelectTrigger id="ds-carrier" className="w-full">
                <SelectValue placeholder="Select a carrier" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Preferred</SelectLabel>
                  <SelectItem value="aetna">Aetna</SelectItem>
                  <SelectItem value="cigna">Cigna</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>All carriers</SelectLabel>
                  <SelectItem value="oscar">Oscar</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ds-tenant">Tenant ID</Label>
            <Input id="ds-tenant" defaultValue="tn_4f2a91" disabled />
          </div>
        </div>
      </Section>

      <Section title="Card" note="12px corner, flat at rest, one idea per card. The action in the header is never primary.">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Lead pipeline</CardTitle>
            <CardDescription>Open leads by stage, this week.</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" onClick={press("Card · Export")}>
                Export
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex gap-3">
            {[
              ["184", "New"],
              ["92", "Contacted"],
              ["31", "Quoted"],
            ].map(([n, label]) => (
              <div key={label} className="flex-1 rounded-md bg-muted p-3">
                <span className="block text-2xl font-semibold tracking-[-0.02em]">{n}</span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">Updated 4 minutes ago</CardFooter>
        </Card>
      </Section>

      <Section title="Table" note="Border-led and dense. Uppercase header on the muted band, figures right-aligned and tabular.">
        <Card className="w-full overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Insured</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Premium</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["Dana Whitfield", "POL-40128", "Aetna", "good", "Active", "$412.60"],
                ["Marcus Oyelaran", "POL-40131", "Cigna", "warning", "Pending review", "$288.00"],
                ["Priya Raghunathan", "POL-39984", "UnitedHealthcare", "danger", "Payment failed", "$1,024.15"],
              ].map(([name, id, carrier, tone, state, premium]) => (
                <TableRow key={id}>
                  <TableCell>
                    {name}
                    <span className="block text-xs text-muted-foreground">{id}</span>
                  </TableCell>
                  <TableCell>{carrier}</TableCell>
                  <TableCell>
                    <StatusChip tone={tone as StatusTone} dot>
                      {state}
                    </StatusChip>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{premium}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>

      <Section title="SettingsLayout" note="Sections on the left, the open one in the middle, and the save bar that appears when a form is dirty.">
        <div className="w-full">
          <SettingsLayout
            sections={[
              { key: "agency-profile", label: "Agency profile" },
              { key: "carrier-library", label: "Carrier library" },
              { key: "team-access", label: "Team & access" },
            ]}
            active={section}
            onSelect={setSection}
          >
            <Card>
              <CardHeader>
                <CardTitle>{section === "agency-profile" ? "Agency profile" : section === "carrier-library" ? "Carrier library" : "Team & access"}</CardTitle>
                <CardDescription>The open panel renders here.</CardDescription>
              </CardHeader>
              <CardContent>
                <SettingsSaveBar note="Changes are effective-dated and audited.">
                  <Button variant="secondary" onClick={press("Discard")}>Discard</Button>
                  <Button onClick={press("Save changes")}>Save changes</Button>
                </SettingsSaveBar>
              </CardContent>
            </Card>
          </SettingsLayout>
        </div>
      </Section>

      <Section
        title="States"
        note="An empty list and a failed request look nothing alike. An error is never drawn as an empty state."
      >
        <div className="grid w-full gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-card">
            <EmptyState
              title="No policies yet"
              hint="Import a CSV or add one by hand."
              action={<Button size="sm" onClick={press("Import policies")}>Import policies</Button>}
            />
          </div>
          <div className="rounded-lg border border-border bg-card">
            <ErrorState
              title="We could not load your vendors."
              detail="The request failed. An error is never an empty state."
              action={<Button size="sm" variant="secondary" onClick={press("Try again")}>Try again</Button>}
            />
          </div>
        </div>
      </Section>

      <Section title="Dialog" note="One decision. The title names the thing, and the destructive confirm is never autofocused.">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Suspend Northeast Benefits?</DialogTitle>
              <DialogDescription>
                Their 14 agents lose access at their next request. Policies, commissions and audit
                history are kept, and you can restore the account at any time.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary" onClick={press("Cancel")}>Cancel</Button>
              </DialogClose>
              <Button variant="destructive" onClick={press("Suspend account")}>Suspend account</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>
    </main>
  );
}
