"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { Toaster } from "@/components/ui/sonner";

import { SignedOutError, WorkspaceChangedError } from "./api";

/** Client-side state shared by every screen: the query cache and toasts. */
export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();

  // One client per browser tab, created once (not on every render).
  const [queryClient] = useState(() => {
    /**
     * Errors that no single screen can handle. A lost session sends the user
     * to sign in and back. A workspace switched elsewhere drops every cached
     * answer and reloads the page for the workspace that is now active.
     */
    const onError = (error: Error) => {
      if (error instanceof SignedOutError) {
        const { pathname, search } = window.location;
        const next = encodeURIComponent(`${pathname}${search}`);
        router.replace(`/sign-in?next=${next}`);
      } else if (error instanceof WorkspaceChangedError) {
        client.clear();
        router.refresh();
      }
    };
    const client: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    });
    return client;
  });
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
