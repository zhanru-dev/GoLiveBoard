import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { server } from "./server";

// Every HTTP request in a test must be answered by an MSW handler; an
// unexpected request fails the test instead of reaching the network.
beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
  cleanup();
  vi.clearAllMocks();
});
afterAll(() => {
  server.close();
});

// jsdom has no matchMedia; the toaster uses it to follow the colour scheme.
// Only the current API is provided, not the deprecated addListener pair.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as Partial<MediaQueryList> as MediaQueryList,
});

// The App Router's hooks need a running Next.js app; tests use a fake router.
export const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
