// LA-2.12, decision 12 · run the close-out pass.
//
// The CLI half of app/api/internal/appointment-close-out, for a cron that runs a command rather
// than posting to a URL. Both call the same function, so there is one behaviour to reason about.
const { processAppointmentCloseOut } = await import("../lib/appointments/closeOut.ts");

const summary = await processAppointmentCloseOut();
console.log(
  `close-out: ${summary.tenants} tenant(s) · ${summary.markedShowed} marked showed · ${summary.markedPending} parked as pending`,
);
for (const failure of summary.failures) {
  console.error(`  ! ${failure.tenantId}: ${failure.message}`);
}
// A failure for one tenant is reported and does not fail the run: the other tenants were closed out
// correctly, and a non-zero exit would make a scheduler retry work that is already done.
