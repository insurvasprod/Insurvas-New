import Link from "next/link";
import { redirect } from "next/navigation";

import { CarrierFileUploadButton } from "@/components/app/carrier-file-upload";
import { FirstValueSample, ForwardAddress } from "@/components/app/first-value";
import { FunnelFrame, FunnelHeading } from "@/components/app/funnel-frame";
import { Button } from "@/components/ui/button";
import { owedToYou } from "@/lib/discrepancies/service";
import { guardPage } from "@/lib/entitlements/guardPage";
import { getInboundAddress, libraryCarriers, listCarrierFiles } from "@/lib/ingestion/registry";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

export const dynamic = "force-dynamic";

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * After the five sign-up steps (redesign A, 2026-10-24; renumbered 2026-10-26): the activation moment the spec names — "You appear to be
 * owed $X" after the first statement (Basic Idea §8, LA-4.6). Checkout lands here instead of on the
 * walkthrough, so the first thing a paying owner does is the thing Insurvas is for.
 *
 * The figure is Discrepancies' own (owedToYou), never estimated here. Until a statement has been
 * read it is not shown at all; the sample beside the upload is labelled as a sample.
 *
 * Owner and bookkeeper only (`statements.view`), with the plan's carrier-file feature; anyone else,
 * and an owner whose plan has no carrier files, goes on to the walkthrough.
 */
export default async function WelcomePage() {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");
  const destination = signupDestination(context);
  if (destination) redirect(destination);

  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled || guard.entitlement.access === "read_only" || !hasTenantPermission(guard.role, "statements.view")) redirect("/app/setup");

  const tenantId = guard.context.tenantId;
  const [owed, files, carriers, inbound] = await Promise.all([
    owedToYou(tenantId).catch(() => null),
    listCarrierFiles(tenantId, 5).catch(() => null),
    libraryCarriers().catch(() => []),
    getInboundAddress(tenantId).catch(() => null),
  ]);
  const recent = files?.files ?? [];
  // What the newest files say about the figure: still being read, read with nothing owed, or unreadable.
  const reading = recent.some((file) => file.status === "received" || file.status === "parsing" || file.waitingForLayout);
  const read = recent.some((file) => file.status === "parsed");
  const failed = !reading && !read ? recent.find((file) => file.status === "failed") ?? null : null;
  const found = owed?.available && owed.totalCents > 0 ? owed : null;

  return (
    <FunnelFrame step={6}>
      {found ? (
        <>
          <FunnelHeading title="Here is your first number.">Every line of your statement was matched to a policy and compared with what your contract says you should be paid.</FunnelHeading>
          <section className="rounded-xl bg-[var(--brand-700)] px-5 py-5 text-[var(--on-dark)]" aria-label="You appear to be owed">
            <p className="text-sm text-[var(--nav-muted)]">You appear to be owed</p>
            <p className="mt-1 text-[2.75rem] font-semibold leading-none tracking-[-0.035em] tabular-nums">{money(found.totalCents)}</p>
            <p className="mt-2 text-sm text-[var(--nav-muted)]">{found.count.toLocaleString("en-US")} open item{found.count === 1 ? "" : "s"}: missing, short-paid or charged back twice</p>
          </section>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild className="h-12 flex-1 px-5"><Link href="/app/discrepancies">See what is owed</Link></Button>
            <Button asChild variant="outline" className="h-12 border-[var(--border-strong)] px-5"><Link href="/app/setup">Continue setup</Link></Button>
          </div>
        </>
      ) : (
        <>
          <FunnelHeading title="Let’s find money the carriers owe you.">
            Add one commission statement. Insurvas matches every line to a policy and shows what was not paid.
          </FunnelHeading>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-xl border-2 border-dashed border-[color-mix(in_srgb,var(--primary)_55%,transparent)] bg-[var(--primary-soft)] p-5">
              <p className="text-base font-semibold tracking-[-0.02em] text-foreground">Upload a statement</p>
              <p className="text-sm leading-normal text-[var(--body)]">CSV, Excel or PDF, straight from the carrier&rsquo;s portal.</p>
              <div><CarrierFileUploadButton carriers={carriers} /></div>
            </div>
            {inbound?.address && <ForwardAddress address={inbound.address} />}
            {reading ? (
              <p role="status" className="rounded-lg bg-[var(--surface-alt)] px-4 py-3 text-sm leading-normal text-[var(--body)]">
                Your statement is being read. That usually takes a few minutes, and the figure appears here and on your Home when it is ready.{" "}
                <Link href="/app/welcome" className="font-semibold text-foreground hover:underline">Check again</Link>
              </p>
            ) : read ? (
              <p role="status" className="rounded-lg bg-[var(--surface-alt)] px-4 py-3 text-sm leading-normal text-[var(--body)]">
                Your files have been read and nothing is owed on them right now. Add another statement, or carry on with setup.
              </p>
            ) : failed ? (
              <p role="alert" className="rounded-lg border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3 text-sm leading-normal text-[var(--error-ink)]">
                {failed.originalFilename} could not be read{failed.errorDetail ? `: ${failed.errorDetail}` : "."} Try another export from the carrier, or open{" "}
                <Link href="/app/carrier-files" className="font-semibold underline">Carrier files</Link>.
              </p>
            ) : null}
            <FirstValueSample />
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <Link href="/app/setup" className="text-sm font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline">Do this later and set up the rest</Link>
            </div>
          </div>
        </>
      )}
    </FunnelFrame>
  );
}
