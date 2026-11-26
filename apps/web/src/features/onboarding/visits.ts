import { useSyncExternalStore } from "react";

/**
 * What this browser has opened, for the getting-started checklist: a
 * light convenience (docs/design/learnability.md), so storage that is
 * missing, full or refused only means a step stays unticked.
 */
export type Visit = "ops-room" | "public-page" | "dismissed";

const key = (workspaceId: string, visit: Visit) =>
  `goliveboard:${workspaceId}:${visit}`;

const CHANGED = "goliveboard:visits";

export function remember(workspaceId: string, visit: Visit): void {
  try {
    window.localStorage.setItem(key(workspaceId, visit), "1");
  } catch {
    // Storage refused: the step stays unticked.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function remembered(workspaceId: string, visit: Visit): boolean {
  try {
    return window.localStorage.getItem(key(workspaceId, visit)) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Whether this browser remembers `visit`, kept up to date. The server, which
 * cannot know, renders `serverValue`.
 */
export function useRemembered(
  workspaceId: string,
  visit: Visit,
  serverValue: boolean,
): boolean {
  return useSyncExternalStore(
    subscribe,
    () => remembered(workspaceId, visit),
    () => serverValue,
  );
}
