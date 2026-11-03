import { NotFoundNotice } from "@/components/app/not-found-notice";

/**
 * Any other address that is not a page. There is no shell to keep here — the visitor may not be
 * signed in, or may be on the partner or staff side — so the same notice stands on the canvas and
 * the way back is the front door rather than an agent dashboard.
 */
export default function NotFound() {
  return (
    <main className="portal-gate-standalone">
      <NotFoundNotice homeHref="/" homeLabel="Back to Insurvas" />
    </main>
  );
}
