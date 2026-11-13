import { setupServer } from "msw/node";

/** The fake API for component tests; each test adds the handlers it needs. */
export const server = setupServer();
