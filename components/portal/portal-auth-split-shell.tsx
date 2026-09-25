import type { ReactNode } from "react";

export type PortalAuthMode = "sign-in" | "sign-up";

export function PortalAuthSplitShell({
  mode,
  form,
  story,
  className = "",
}: {
  mode: PortalAuthMode;
  form: ReactNode;
  story: ReactNode;
  className?: string;
}) {
  return (
    <div className={`portal-auth-split-shell ${className}`.trim()} data-mode={mode}>
      <section className="portal-auth-split-form" aria-label={mode === "sign-in" ? "Sign in" : "Create an account"}>
        {form}
      </section>
      <aside className="portal-auth-split-story" aria-label="Insurvas workspace benefits">
        {story}
      </aside>
    </div>
  );
}
