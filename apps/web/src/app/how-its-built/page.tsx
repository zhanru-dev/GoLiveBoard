import type { Metadata } from "next";

import { HowBuiltPage } from "@/features/how-built/how-built-page";

export const metadata: Metadata = {
  title: "How it's built",
  description:
    "The engineering behind GoLiveBoard: architecture, decisions and their costs, the release pipeline, and the evidence.",
};

export default function Page() {
  return <HowBuiltPage />;
}
