import type { DemoPersonKey } from "./domain/demo-seed.js";

/**
 * The shared demo workspace and its people (FR-AUTH-5). Fixed IDs, so the
 * seed and the nightly reset find and restore the same rows, and visitors'
 * sessions survive a reset.
 *
 * The addresses use the reserved `.invalid` top-level domain: they can never
 * receive email, the request schemas refuse them (so nobody can register,
 * invite or reset the password of a demo account), and the mailer never
 * sends to them.
 */
export const DEMO_EMAIL_DOMAIN = "demo.opspilot.invalid";

export const DEMO_WORKSPACE = {
  id: "00000000-0000-7000-8000-00000000de00",
  name: "Northwind Events (demo)",
} as const;

export const DEMO_PEOPLE = {
  /** Owns the workspace; nobody can sign in as them. */
  owner: {
    id: "00000000-0000-7000-8000-00000000de01",
    name: "Jordan Lee",
    email: `owner@${DEMO_EMAIL_DOMAIN}`,
    role: "OWNER",
  },
  /** Every visitor is signed in as this Manager. */
  manager: {
    id: "00000000-0000-7000-8000-00000000de02",
    name: "Demo Visitor",
    email: `visitor@${DEMO_EMAIL_DOMAIN}`,
    role: "MANAGER",
  },
  analyst: {
    id: "00000000-0000-7000-8000-00000000de03",
    name: "Priya Shah",
    email: `analyst@${DEMO_EMAIL_DOMAIN}`,
    role: "ANALYST",
  },
} as const satisfies Record<
  DemoPersonKey,
  {
    id: string;
    name: string;
    email: string;
    role: "OWNER" | "MANAGER" | "ANALYST";
  }
>;
