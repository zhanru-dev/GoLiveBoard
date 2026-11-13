import { ApiError } from "./api";

/** A message for an error that no form field can show. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }
  if (error.problem.code === "VERSION_CONFLICT") {
    return "Someone else changed this in the meantime. The latest version is now shown; please check it and try again.";
  }
  return error.problem.detail ?? error.problem.title;
}
