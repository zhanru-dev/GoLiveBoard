import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-4xl font-semibold tracking-tight">OpsPilot</h1>
      <p className="text-lg text-muted-foreground">
        Launch control for online events: know when an event is ready to go
        live, and keep it under control while it runs.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/sign-up">Create your workspace</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
