/**
 * Any other address (the form moved on after saving, or another page was opened): nothing is open. The `@sheet` slot draws a "New…" or "Invite…" form over the page only when it is opened
 * from inside the app (components/app/route-sheet.tsx); everywhere else it is empty.
 */
export default function NoSheet() {
  return null;
}
