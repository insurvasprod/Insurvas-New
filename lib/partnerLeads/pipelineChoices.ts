/**
 * Pure: which pipelines a partner's pipeline picker may name (roles board P1–P3, finding 4: "a
 * marketing partner sees the publisher and affiliate pipeline names").
 *
 * Only the partner's own: its type's default pipeline (LA-1.9) and any pipeline that holds at least
 * one of its leads. Another type's pipeline that holds none of its leads is never named. The own
 * pipeline comes first; the rest keep the read model's order.
 */
export function ownPipelineChoices<T extends { id: string }>(choices: readonly T[], ownPipelineId: string | null, holdingIds: ReadonlySet<string>): T[] {
  const own = choices.filter((choice) => choice.id === ownPipelineId);
  const holding = choices.filter((choice) => choice.id !== ownPipelineId && holdingIds.has(choice.id));
  return [...own, ...holding];
}
