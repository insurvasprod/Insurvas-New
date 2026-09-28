import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
// Server component only. The transport pulls in nodemailer and the service client; nothing on this
// page is a client component, and nothing here may pass the transport's module into one.
import { emailConfigProblems, emailDeliveryMode } from "@/lib/email/transport";
import { PageHeader } from "@/components/ui/page-header";
import { ConfigurationPlaceholder } from "@/components/admin/configuration-placeholder";

/** What sendEmail() will do in THIS environment, in the order it checks (lib/email/transport.ts). */
function deliveryStatus(): string {
  // Names only. emailConfigProblems() never returns a value, and nothing on this page reads one.
  const missing = emailConfigProblems().filter((name) => !name.startsWith("EMAIL_DELIVERY_MODE"));
  const unset = missing.length > 0 ? ` These settings are also not set: ${missing.join(", ")}.` : "";

  if (emailDeliveryMode() !== "smtp") {
    return `Delivery is turned off in this environment, so emails are recorded in the delivery log as skipped and none are sent.${unset}`;
  }
  if (missing.length > 0) {
    return `Insurvas does not send email from this environment because these settings are not set: ${missing.join(", ")}. Emails are recorded in the delivery log as skipped.`;
  }
  return "Email is sent through SMTP from this environment, and every attempt is recorded in the delivery log.";
}

export default async function EmailPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is the authority on who may open this screen
  // (super_admin and platform_config).
  if (!canAccessConfigurationSection(admin.role, "email")) redirect("/admin");

  // SA-4.11 is On Hold: the SMTP transport and the delivery log exist, but there is no settings
  // table and no template editor, so this screen reports what is true rather than showing a form
  // that saves values nothing reads.
  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {/* "Mail Setup" to match the sidebar. Route stays /admin/email. */}
      <PageHeader title="Mail Setup" />
      <ConfigurationPlaceholder
        title="Mail setup is not editable here"
        lede={deliveryStatus()}
        detail="The mail server and sender are set in the server's environment and email wording is in code, so changing either takes a deploy."
      />
    </div>
  );
}
