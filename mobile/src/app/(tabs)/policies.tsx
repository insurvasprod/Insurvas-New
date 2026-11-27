import { PoliciesScreen } from "@/components/book/policies";

/**
 * The Book tab (board F1) for retention reps and bookkeepers: the same policies list as Menu › Policies,
 * drawn as a tab (no back arrow). Named apart from /book so the tab and the stack screen never share
 * an address.
 */
export default function PoliciesTab() {
  return <PoliciesScreen asTab />;
}
