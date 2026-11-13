import type { Me } from "@opspilot/contracts";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { MeProvider } from "@/features/shell/me-context";
import { Providers } from "@/lib/providers";

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

/**
 * Renders a screen inside the app's real providers (a fresh query cache with
 * the global error handling, and toasts) and, if given, a signed-in user.
 */
export function renderScreen(ui: ReactElement, me?: Me) {
  return render(
    <Providers>
      {me === undefined ? ui : <MeProvider value={me}>{ui}</MeProvider>}
    </Providers>,
  );
}
