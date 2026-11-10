import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OpsPilot", template: "%s · OpsPilot" },
  description:
    "Launch control for online events: know when an event is ready to go live, and keep it under control while it runs.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
