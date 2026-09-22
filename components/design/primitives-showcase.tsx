"use client";

import { useState } from "react";

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

const TONES: StatusTone[] = ["neutral", "good", "info", "warning", "danger", "action"];
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

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold leading-[1.21] tracking-[-0.02em]">Insurvas primitives</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Every variant and state of the shared controls. Toggle the theme and check both; this
            page is the exit check for a primitive change, and the reference a page review is held
            against.
          </p>
        </div>
        <ThemeToggle />
      </header>

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
