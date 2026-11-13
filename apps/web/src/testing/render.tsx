import type { Me } from "@opspilot/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { MeProvider } from "@/features/shell/me-context";

export const OWNER: Me = {
  user: {
    id: "0195f0a0-0000-7000-8000-000000000001",
    name: "Ada Lovelace",
    email: "ada@example.com",
  },
  activeWorkspace: {
    workspaceId: "0195f0a0-0000-7000-8000-0000000000aa",
    workspaceName: "Ada's workspace",
    role: "OWNER",
  },
  memberships: [
    {
      workspaceId: "0195f0a0-0000-7000-8000-0000000000aa",
      workspaceName: "Ada's workspace",
      role: "OWNER",
    },
  ],
};

/** Renders a screen with a fresh query cache and, if given, a signed-in user. */
export function renderScreen(ui: ReactElement, me?: Me) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {me === undefined ? ui : <MeProvider value={me}>{ui}</MeProvider>}
    </QueryClientProvider>,
  );
}
