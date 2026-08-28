import "server-only";

/**
 * Transport seam for outbound email.
 *
 * There is deliberately no email provider wired up yet — SA-4.11 (Email configuration) owns
 * that decision, including templates and the vendor choice. Until then this logs the invite
 * and the admin UI shows a copyable link, so the flow is fully usable and testable without
 * front-running SA-4.11's design.
 *
 * When SA-4.11 lands, replace the body of this function; every caller stays unchanged.
 */
export async function sendInvitationEmail(params: {
  to: string;
  name: string;
  inviteUrl: string;
  expiresAt: Date;
}): Promise<{ delivered: boolean }> {
  console.info(
    `[invitation] would email ${params.to} (${params.name}) — link valid until ${params.expiresAt.toISOString()}: ${params.inviteUrl}`,
  );

  // `delivered: false` is the honest answer while no transport exists — callers use it to tell
  // the admin they must pass the link along themselves.
  return { delivered: false };
}

/** Same seam, for SA-1.3's "send password reset link". */
export async function sendPasswordResetEmail(params: {
  to: string;
  name: string;
  resetUrl: string;
  expiresAt: Date;
}): Promise<{ delivered: boolean }> {
  console.info(
    `[password-reset] would email ${params.to} (${params.name}) — link valid until ${params.expiresAt.toISOString()}: ${params.resetUrl}`,
  );
  return { delivered: false };
}

/**
 * Same seam, for confirming a changed email address. Note this goes to the NEW address — that
 * is the whole point: it proves the person controls it before the change takes effect.
 */
export async function sendEmailChangeConfirmation(params: {
  to: string;
  name: string;
  confirmUrl: string;
  expiresAt: Date;
}): Promise<{ delivered: boolean }> {
  console.info(
    `[email-change] would email ${params.to} (${params.name}) — link valid until ${params.expiresAt.toISOString()}: ${params.confirmUrl}`,
  );
  return { delivered: false };
}
