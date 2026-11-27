import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";

import { Icon } from "@/components/icon";
import { ActionSheet, SelectField, Sheet, SheetField } from "@/components/leads/sheets";
import { Button, F, IOS } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { attachReceipt, snapReceipt, type Photo } from "./device";
import { categoryLabel, EXPENSE_CATEGORIES, localToday, money, PAID_METHODS, parseDay, parseDollars, readableDay, suggestCategory } from "./logic";
import { Mini } from "./parts";
import type { ExpenseRow } from "./types";

/**
 * Board G6 · Add expense: a bottom sheet over Money, after the camera (board G5: Expenses › Add opens the camera
 * first; the route does that, then opens this sheet with the photo). The photo stays attached to the expense for the
 * tax summary. The server cannot read a receipt yet (no receipt reading exists), so the amount, vendor and date are
 * typed from it; the category is suggested from the agency's earlier expenses for the same vendor
 * (GET /api/app/accounting/expenses). Save books it as Expenses › Add does (POST /api/app/accounting/expenses,
 * one-off, paid on its date), then the photo goes onto it (PATCH …/expenses/<id>, multipart). "Paid with" is the
 * expense's payment method — the agency keeps no saved cards to name ("Visa ••4471"). Owner and bookkeeper, as the web.
 */
export function ExpenseSheet({ visible, photo, onPhoto, onClose, onSaved }: {
  visible: boolean; photo: Photo | null; onPhoto: (p: Photo) => void; onClose: () => void; onSaved: (text: string) => void;
}) {
  const p = usePalette();
  const { api, refreshToken } = useSession();
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [day, setDay] = useState(readableDay(localToday()));
  const [method, setMethod] = useState<string>("card");
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState<"method" | "category" | null>(null);
  const [errors, setErrors] = useState<{ amount?: string; vendor?: string; day?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  // Saved, but the photo did not attach: the sheet says so and its button closes it (never saves twice).
  const [savedNote, setSavedNote] = useState<string | null>(null);
  // Earlier expenses, only to suggest a category; a failure leaves the suggestion out.
  const earlier = useLoad(async () => (visible ? api<{ expenses: ExpenseRow[] }>("/api/app/accounting/expenses").then((a) => a.expenses).catch(() => [] as ExpenseRow[]) : []), [visible]);
  const suggested = suggestCategory(earlier.data ?? [], vendor);
  const category = chosen ?? suggested ?? "other";

  const retake = async () => {
    const shot = await snapReceipt();
    if (shot) onPhoto(shot);
  };

  const save = async () => {
    const cents = parseDollars(amount);
    const on = parseDay(day);
    const found = {
      amount: cents && cents > 0 ? undefined : "Enter how much, in dollars and cents.",
      vendor: vendor.trim() ? undefined : "Say who it was paid to.",
      day: on ? undefined : "Write the date like 23 Nov 2026.",
    };
    setErrors(found);
    if (found.amount || found.vendor || found.day || !cents || !on) return;
    setBusy(true);
    try {
      const made = await api<{ id: string }>("/api/app/accounting/expenses", {
        method: "POST",
        body: { category, vendor_name: vendor.trim(), description: null, amount_cents: cents, incurred_on: on, recurrence: "one_off", recurrence_end_on: null, is_acquisition_cost: null, paid_on: on, paid_method: method },
      });
      if (photo) {
        try {
          const token = await refreshToken();
          if (!token) throw new Error("Sign in again to attach the receipt.");
          await attachReceipt({ token, expenseId: made.id, photo });
        } catch (e) {
          setSavedNote(`Expense saved, but the receipt didn’t attach: ${e instanceof Error ? e.message : "no answer"}. Add it on the computer.`);
          return;
        }
      }
      onSaved(`Expense saved: ${vendor.trim()}, ${money(cents)}.`);
    } catch (e) {
      setErrors({ form: e instanceof Error ? e.message : "That didn’t save. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const cents = parseDollars(amount);
  const footer = (
    <View style={{ gap: 10 }}>
      {errors.form || savedNote ? <Text accessibilityLiveRegion="polite" style={{ fontFamily: F.r, fontSize: 13.5, color: savedNote ? p.muted : p.bad }}>{savedNote ?? errors.form}</Text> : null}
      {savedNote ? <Button testID="expense-done" label="Done" onPress={onClose} />
        : <Button write testID="expense-save" label="Save expense" busy={busy} onPress={() => void save()} />}
    </View>
  );
  const shortDay = parseDay(day) ? readableDay(parseDay(day)!).replace(/ \d{4}$/, "") : null;

  return (
    <Sheet visible={visible} title="New expense" onClose={onClose} testID="expense-sheet" footer={footer}>
      <View style={{ gap: 14, paddingBottom: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Pressable testID="expense-photo" accessibilityRole="button" accessibilityLabel={photo ? "Retake the receipt" : "Snap a receipt"} onPress={() => void retake()}
            style={{ width: 64, height: 84, borderRadius: 8, backgroundColor: p.surf2, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {photo ? <Image source={{ uri: photo.uri }} style={{ width: 64, height: 84 }} contentFit="cover" /> : <Icon name="camera" size={24} color={p.muted} />}
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: F.s, fontSize: 15, color: p.ink }}>{photo ? "Receipt attached" : "No receipt yet"}</Text>
            <Mini>{photo ? [vendor.trim() || null, shortDay, cents ? money(cents) : null].filter(Boolean).join(" · ") || "Type what it says below" : "It stays with the expense for the tax summary"}</Mini>
            <Pressable accessibilityRole="button" onPress={() => void retake()} hitSlop={8}><Text style={{ marginTop: 4, fontFamily: F.s, fontSize: 14, color: p.greenInk }}>{photo ? "Retake" : "Snap a receipt"}</Text></Pressable>
          </View>
        </View>
        <SheetField testID="expense-amount" label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="$0.00" error={errors.amount} />
        <SheetField testID="expense-vendor" label="Paid to" value={vendor} onChangeText={setVendor} autoCapitalize="words" placeholder="Who you paid" error={errors.vendor} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}><SheetField testID="expense-date" label="Date" value={day} onChangeText={setDay} error={errors.day} /></View>
          <View style={{ flex: 1 }}><SelectField testID="expense-method" label="Paid with" value={PAID_METHODS.find((m) => m.key === method)?.label ?? method} onPress={() => setPicking("method")} /></View>
        </View>
        <View style={{ gap: 4 }}>
          <SelectField testID="expense-category" label="Category" value={categoryLabel(category)} onPress={() => setPicking("category")} />
          {!chosen && suggested && vendor.trim() ? <Mini style={{ paddingLeft: IOS ? 0 : 16 }}>{`You used this for ${vendor.trim()} last time.`}</Mini> : null}
        </View>
      </View>
      <ActionSheet visible={picking === "method"} title="Paid with" onClose={() => setPicking(null)}
        actions={PAID_METHODS.map((m) => ({ key: m.key, label: m.label, icon: "creditCard" as const, onPress: () => setMethod(m.key) }))} />
      <ActionSheet visible={picking === "category"} title="Category" onClose={() => setPicking(null)}
        actions={EXPENSE_CATEGORIES.map((c) => ({ key: c, label: categoryLabel(c), icon: "receipt" as const, onPress: () => setChosen(c) }))} />
    </Sheet>
  );
}
