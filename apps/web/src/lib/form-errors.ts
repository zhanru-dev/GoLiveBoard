import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { ApiError, WorkspaceChangedError } from "./api";

/**
 * Shows an API error on the form: field errors next to their fields, anything
 * else as one message for the whole form. Returns that message, if any.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string {
  // Not the form's fault: the global handler reloads the page for the
  // workspace that is now active, so there is nothing to show here.
  if (error instanceof WorkspaceChangedError) {
    return "";
  }
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }
  const unplaced = (error.problem.errors ?? []).filter((fieldError) => {
    const field = fields.find((name) => name === fieldError.path);
    if (field === undefined) {
      return true;
    }
    setError(field, { message: fieldError.message });
    return false;
  });
  if (error.problem.errors !== undefined && unplaced.length === 0) {
    return "";
  }
  return error.problem.detail ?? error.problem.title;
}
