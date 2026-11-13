import type { UseFormRegisterReturn } from "react-hook-form";

import { offsetLabel, resolveZonedTime } from "@/lib/time";

/**
 * Shown only when a time happens twice (the clocks go back that night): the
 * user says which one they mean instead of the app guessing.
 */
export function OccurrenceChoiceField({
  label,
  local,
  timeZone,
  registration,
}: Readonly<{
  label: string;
  local: string;
  timeZone: string;
  registration: UseFormRegisterReturn;
}>) {
  const resolved = local === "" ? undefined : safeResolve(local, timeZone);
  if (resolved?.kind !== "ambiguous") {
    return null;
  }
  const time = local.slice(11, 16);
  return (
    <fieldset className="grid gap-1 text-sm">
      <legend className="mb-1 font-medium">
        {label}: {time} happens twice in {timeZone}
      </legend>
      <label className="flex items-center gap-2">
        <input type="radio" value="earlier" {...registration} />
        The first {time} ({offsetLabel(resolved.earlier, timeZone)})
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" value="later" {...registration} />
        The second {time} ({offsetLabel(resolved.later, timeZone)})
      </label>
    </fieldset>
  );
}

/** An unknown zone (while the user is still choosing) resolves to nothing. */
function safeResolve(local: string, timeZone: string) {
  try {
    return resolveZonedTime(local, timeZone);
  } catch {
    return undefined;
  }
}
