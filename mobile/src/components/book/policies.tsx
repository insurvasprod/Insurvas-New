import { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import type { IconName } from "@/components/icon";
import { ActionSheet } from "@/components/leads/sheets";
import { Button, Chip, Empty, Failed, FilterChips, Group, Header, Loading, Screen, SearchBox } from "@/components/ui";
import { displayName } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { money, premiumText, toneOf } from "./format";
import { PolicyRow } from "./parts";
import type { BookChip, BookPage, BookRow } from "./types";

/**
 * Board F1 · Policies: the book, searchable by name, policy number or phone (the server matches a phone against the
 * client's number and never sends the number back: no client contact detail on the list). The web's own list
 * (GET /api/app/policy-book): its rows, its Health chip and its sort; a producer sees their own book. The chips cut
 * it the board's way; the counts follow the search. Opened from Menu (or the bookkeeper's Book tab, `asTab`).
 */
const CHIPS: { key: BookChip; label: string }[] = [
  { key: "inforce", label: "In force" }, { key: "pending", label: "Pending" }, { key: "lapsed", label: "Lapsed" }, { key: "chargedback", label: "Charged back" },
];

/**
 * A row's facts, as drawn: "<mono>policy</mono> · carrier · premium". The board writes the premium's mode on the first
 * row only ("$41.20/mo"), the rest as the bare figure ("$55.70"): the column says it once.
 */
export function rowFacts(row: Pick<BookRow, "carrierName" | "premiumCents" | "premiumMode">, first: boolean): string[] {
  const premium = first ? premiumText(row.premiumCents, row.premiumMode) : row.premiumCents === null ? null : money(row.premiumCents);
  return [row.carrierName, premium].filter((f): f is string => Boolean(f));
}

/** Where a row opens: the phone's policy page, or the web's own page for a policy entered by hand. */
export function openRow(row: BookRow) {
  if (row.opens === "policy") {
    // Cast: the typed-route list is regenerated only when Metro runs, after these files exist.
    router.push({ pathname: "/book/[carrierId]/[policyNumber]", params: { carrierId: row.carrierId, policyNumber: row.policyNumber } } as never);
    return;
  }
  router.push({ pathname: "/computer", params: { path: row.webPath ?? "/app/policies", title: "This policy", why: "A policy entered by hand keeps its own page on the web." } });
}

export function PoliciesScreen({ asTab = false }: { asTab?: boolean }) {
  const { api } = useSession();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<BookChip | null>("inforce");
  // Pages after the first, kept for the search and chip they were read for.
  const [more, setMore] = useState<{ key: string; rows: BookRow[]; next: number | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showing, setShowing] = useState(false);

  // The search waits for a pause in typing, so each key press is not a trip to the server.
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const query = (offset: number) => `/api/app/policy-book?${new URLSearchParams({ ...(q ? { q } : {}), ...(chip ? { chip } : {}), ...(offset ? { offset: String(offset) } : {}) }).toString()}`;
  const key = `${q}|${chip ?? ""}`;
  const page = useLoad(() => api<BookPage>(query(0)), [q, chip]);
  const extra = more?.key === key ? more : null;
  const rows = [...(page.data?.rows ?? []), ...(extra?.rows ?? [])];
  const next = extra ? extra.next : page.data?.next ?? null;

  async function loadMore() {
    if (next === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const answer = await api<BookPage>(query(next));
      setMore({ key, rows: [...(extra?.rows ?? []), ...answer.rows], next: answer.next });
    } catch {
      // The rows already shown stay; the button stays to try again.
    } finally {
      setLoadingMore(false);
    }
  }

  const counts = page.data?.counts;
  const header = (
    <Header title="Book" back={asTab ? undefined : "Menu"} onBack={asTab ? undefined : router.back} large
      actions={[{ icon: "sliders", label: "Show", onPress: () => setShowing(true) }]}
      below={<SearchBox testID="book-search" value={typed} onChangeText={setTyped} placeholder="Name, policy number or phone" />}
      belowFull={(
        <View style={{ paddingBottom: 10 }}>
          <FilterChips items={CHIPS.map((c) => ({ key: c.key, label: c.label, count: counts ? counts[c.key] : undefined }))} value={chip}
            onChange={(k) => setChip((now) => (now === k ? null : (k as BookChip)))} />
        </View>
      )} />
  );

  return (
    <Screen header={header} onRefresh={page.refresh} refreshing={page.refreshing}>
      {page.loading && !page.data ? <Loading rows={7} />
        : page.error && !page.data ? <Failed what="the book" message={page.error} onRetry={page.reload} />
          : page.data && !page.data.available && !rows.length ? <Empty icon="book" title="The policy list isn’t ready yet" body="It needs a database update. The web says which one." />
            : !rows.length ? (
              q ? <Empty icon="search" title="No policy matches" body={`Nothing in ${page.data?.scoped ? "your book" : "the book"} matches “${q}”${chip ? " with this chip" : ""}.`} />
                : <Empty icon="book" title={chip ? "None right now" : "No policies yet"} body={chip ? "Tap the chip again to see every policy." : "Policies arrive with the carriers’ files, or when a sale is recorded as issued."} />
            ) : (
              <>
                <Group>
                  {rows.map((row, i) => (
                    <PolicyRow key={`${row.carrierId}|${row.policyNumber}`} testID={`book-row-${row.policyNumber}`} first={i === 0}
                      title={displayName(row.clientName) ?? `Policy ${row.policyNumber}`} policyNumber={row.policyNumber}
                      facts={rowFacts(row, i === 0)}
                      chip={<Chip tone={toneOf(row.health.tone)}>{row.health.label}</Chip>}
                      onPress={() => openRow(row)} />
                  ))}
                </Group>
                {next !== null ? (
                  <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
                    <Button testID="book-more" kind="outline" label={`Show more · ${((page.data?.total ?? 0) - rows.length).toLocaleString("en-US")} left`} busy={loadingMore} onPress={() => void loadMore()} />
                  </View>
                ) : null}
              </>
            )}
      <ActionSheet visible={showing} title="Show" onClose={() => setShowing(false)} actions={[
        ...CHIPS.map((c) => ({ key: c.key, label: `${c.label}${counts ? ` · ${counts[c.key].toLocaleString("en-US")}` : ""}`, icon: (chip === c.key ? "check" : "book") as IconName, onPress: () => setChip(c.key) })),
        { key: "all", label: `Every policy${counts ? ` · ${counts.all.toLocaleString("en-US")}` : ""}`, icon: (chip === null ? "check" : "book") as IconName, onPress: () => setChip(null) },
      ]} />
    </Screen>
  );
}
