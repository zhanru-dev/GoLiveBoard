import { z } from "zod";

/** The real-time channels of an event (docs/04, section 4). */
export const RealtimeChannel = z.enum(["CHAT", "QUESTIONS"]);
export type RealtimeChannel = z.infer<typeof RealtimeChannel>;

/** FR-RN-4 and FR-RN-5. */
export const QuestionStatus = z.enum([
  "PENDING",
  "PUBLISHED",
  "HIDDEN",
  "ANSWERED",
]);
export type QuestionStatus = z.infer<typeof QuestionStatus>;
