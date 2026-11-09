import { ShellLoading } from "@/components/app/shell-loading";

// A merged page's next step keeps its title and rail; anything else gets the one whole-page skeleton (ShellLoading).
export default function Loading() {
  return <ShellLoading />;
}
