/**
 * Moves one task in the runbook order (FR-LC-1).
 *
 * @param order - task IDs in their current order
 * @param taskId - the task to move; must be in `order`
 * @param afterId - the task it should follow, or `null` to make it first;
 * must be in `order` and differ from `taskId`
 * @returns the new order, or `undefined` when an ID is not in the runbook or
 * a task is asked to follow itself
 */
export function moveAfter(
  order: readonly string[],
  taskId: string,
  afterId: string | null,
): string[] | undefined {
  if (!order.includes(taskId) || afterId === taskId) {
    return undefined;
  }
  const rest = order.filter((id) => id !== taskId);
  if (afterId === null) {
    return [taskId, ...rest];
  }
  const index = rest.indexOf(afterId);
  if (index === -1) {
    return undefined;
  }
  return [...rest.slice(0, index + 1), taskId, ...rest.slice(index + 1)];
}
