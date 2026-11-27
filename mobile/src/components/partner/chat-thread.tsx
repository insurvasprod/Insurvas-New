import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { F, IOS } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

import type { ThreadItem } from "./logic";

/**
 * One conversation, drawn as the board's H3 (and the partner's side of the same thread): a time line
 * where a stretch starts, bubbles (theirs left on surf2, yours right in green), "Maya · 2:11 pm" under
 * theirs, and a lead update as a small record card that opens the lead. New messages rise in; the
 * history already on screen stays still. The composer is the board's: a clip (when sending a file is
 * allowed), the field, and the send button, always green (it does nothing until there is something to send).
 */
export function ChatThread({ items, readMark, onOpenCard, draft, onDraft, onSend, sending, onAttach, attachLabel = "Attach a photo", placeholder, error }: {
  items: ThreadItem[];
  readMark: string | null;
  onOpenCard?: (workItemId: string) => void;
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  /** Present only when the route accepts a file. */
  onAttach?: () => void;
  /** What the clip offers, for a screen reader. */
  attachLabel?: string;
  placeholder: string;
  error?: string | null;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollViewInstance>(null);
  // Which messages were already on screen when the thread opened: only later ones rise in.
  const [seen] = useState(() => new Set(items.map((i) => i.key)));
  const canSend = draft.trim().length > 0 && !sending;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} keyboardShouldPersistTaps="handled">
        {items.map((item, index) => (
          <Rise key={item.key} animate={!seen.has(item.key)}>
            {item.kind === "day" ? (
              <Text style={{ textAlign: "center", fontFamily: F.r, fontSize: 12.5, color: p.muted, marginTop: 6, marginBottom: 10 }}>{item.label}</Text>
            ) : item.kind === "card" ? (
              <View>
                <Pressable testID={`card-${item.key}`} accessibilityRole={item.workItemId && onOpenCard ? "button" : undefined} accessibilityLabel={`${item.customer}, ${item.facts}`}
                  disabled={!item.workItemId || !onOpenCard} onPress={() => item.workItemId && onOpenCard?.(item.workItemId)}
                  style={({ pressed }) => ({ maxWidth: "78%", marginVertical: 4, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: p.line, backgroundColor: pressed ? p.surf2 : p.surf })}>
                  <Icon name="user" size={18} color={p.muted} />
                  <View style={{ flexShrink: 1 }}>
                    <Text numberOfLines={1} style={{ fontFamily: F.s, fontSize: 15, color: p.ink }}>{item.customer}</Text>
                    <Text numberOfLines={1} style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{item.facts}</Text>
                  </View>
                </Pressable>
                {item.meta ? <Text style={meta(p.muted)}>{item.meta}</Text> : null}
              </View>
            ) : (
              <View>
                <View style={{ maxWidth: "78%", alignSelf: item.mine ? "flex-end" : "flex-start", marginVertical: 3, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 18, backgroundColor: item.mine ? p.green : p.surf2, ...(item.mine ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }) }}>
                  <Text style={{ fontFamily: F.r, fontSize: 15.5, lineHeight: 21, color: item.mine ? p.onGreen : p.ink }}>{item.text}</Text>
                  {item.attachments.map((a) => (
                    <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                      <Icon name={a.contentType.startsWith("image/") ? "image" : "file"} size={16} color={item.mine ? p.onGreen : p.muted} />
                      <Text numberOfLines={1} style={{ fontFamily: F.m, fontSize: 13.5, color: item.mine ? p.onGreen : p.body, flexShrink: 1 }}>{a.fileName}</Text>
                    </View>
                  ))}
                </View>
                {item.meta ? <Text style={meta(p.muted)}>{item.meta}</Text> : null}
                {item.mine && readMark && isLastMine(items, index) ? <Text style={[meta(p.muted), { textAlign: "right" }]}>{readMark}</Text> : null}
              </View>
            )}
          </Rise>
        ))}
      </ScrollView>
      {error ? <Text accessibilityRole="alert" style={{ paddingHorizontal: 16, paddingBottom: 6, fontFamily: F.r, fontSize: 13, color: p.bad }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 + insets.bottom, backgroundColor: IOS ? p.bar : p.surf, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }}>
        {onAttach ? (
          <Pressable testID="chat-attach" accessibilityRole="button" accessibilityLabel={attachLabel} onPress={onAttach} hitSlop={8}><Icon name="clip" size={24} color={p.muted} /></Pressable>
        ) : null}
        <TextInput value={draft} onChangeText={onDraft} placeholder={placeholder} placeholderTextColor={p.faint} accessibilityLabel={placeholder} multiline maxLength={2000}
          style={{ flex: 1, minHeight: IOS ? 38 : 48, maxHeight: 120, borderRadius: IOS ? 19 : 24, paddingHorizontal: 14, paddingTop: IOS ? 9 : 13, paddingBottom: IOS ? 9 : 13, fontFamily: F.r, fontSize: 16, color: p.ink, backgroundColor: IOS ? p.field : p.surf2, borderWidth: IOS ? 1 : 0, borderColor: p.line2 }} />
        <Pressable testID="chat-send" accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !canSend }} disabled={!canSend} onPress={onSend}
          style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: p.green, opacity: sending ? 0.6 : 1 }}>
          <Icon name="send" size={18} color={p.onGreen} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const meta = (color: string) => ({ fontFamily: F.r, fontSize: 12, color, marginTop: 2, marginHorizontal: 4, marginBottom: 8 });

function isLastMine(items: ThreadItem[], index: number): boolean {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "bubble" && it.mine) return i === index;
  }
  return false;
}

/** A message that arrives while the thread is open rises 8px into place (a fade with reduced motion); the rest never move. */
function Rise({ animate, children }: { animate: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const [v] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    if (animate) Animated.timing(v, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [animate, v]);
  return <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : 8, 0] }) }] }}>{children}</Animated.View>;
}
