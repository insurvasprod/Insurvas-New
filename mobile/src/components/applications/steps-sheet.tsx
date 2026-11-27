import { Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { Sheet } from "@/components/leads/sheets";
import { Chip, F, Row } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

import type { StepKey, StepState } from "./logic";

/**
 * Board E2b · all ten steps on a sheet: done (a green tick), now (a ringed number and the Now chip),
 * and locked (a lock; a step opens once the one before it is finished, as on the web's rail). A tap
 * on a step that is open goes there.
 */
export function StepsSheet({ visible, title, steps, metaFor, onPick, onClose }: {
  visible: boolean; title: string; steps: StepState[]; metaFor: (key: StepKey, s: StepState) => string | null; onPick: (key: StepKey) => void; onClose: () => void;
}) {
  const p = usePalette();
  return (
    <Sheet visible={visible} title={title} onClose={onClose} testID="app-steps-sheet">
      <View style={{ marginHorizontal: -16 }}>
        {steps.map((s) => {
          const dot = s.state === "done"
            ? { backgroundColor: p.green }
            : s.state === "now" ? { borderWidth: 2, borderColor: p.green } : { backgroundColor: p.surf2 };
          const lead = (
            <View style={[{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" }, dot]}>
              {s.state === "done" ? <Icon name="check" size={14} color={p.onGreen} /> : <Text style={{ fontFamily: F.s, fontSize: 12, color: s.state === "now" ? p.greenInk : p.faint }}>{s.number}</Text>}
            </View>
          );
          return (
            // `first` on every row: the board draws this list without separators.
            <Row key={s.key} testID={`app-step-${s.key}`} first lead={lead} title={s.label} meta={metaFor(s.key, s)} selected={s.state === "now"} chevron={false}
              chip={s.state === "locked" ? <Icon name="lock" size={16} color={p.faint} /> : s.state === "now" ? <Chip tone="brand">Now</Chip> : null}
              onPress={s.state === "locked" ? undefined : () => onPick(s.key)} />
          );
        })}
      </View>
    </Sheet>
  );
}
