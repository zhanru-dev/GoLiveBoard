"use client";

import { RouteError } from "@/components/route-error";

/** A page in this group that fails to render keeps its layout (route-error.tsx). */
export default function Error(props: { error: unknown; retry: () => void }) {
  return <RouteError {...props} />;
}
