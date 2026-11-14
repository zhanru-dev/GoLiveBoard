import { expect } from "@playwright/test";

import { target } from "./target.js";

const MAILPIT_URL = target.mailpitURL;

interface MessageSummary {
  readonly ID: string;
}

/**
 * The text of the newest email sent to an address, read from Mailpit's API.
 * Polls briefly: the API sends email after answering the request.
 */
export async function latestEmailTo(address: string): Promise<string> {
  let text = "";
  await expect(async () => {
    const search = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
    );
    const { messages } = (await search.json()) as {
      messages: MessageSummary[];
    };
    const [newest] = messages;
    expect(newest).toBeDefined();
    const message = await fetch(
      `${MAILPIT_URL}/api/v1/message/${newest?.ID ?? ""}`,
    );
    ({ Text: text } = (await message.json()) as { Text: string });
  }).toPass({ timeout: 10_000 });
  return text;
}

/** The first link in an email. */
export function linkIn(text: string): string {
  const match = /https?:\/\/\S+/.exec(text);
  if (match === null) {
    throw new Error(`No link in email:\n${text}`);
  }
  return match[0];
}
