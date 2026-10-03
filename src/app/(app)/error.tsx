"use client";

import { RotateCcw } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card card-pad mx-auto mt-10 max-w-lg">
      <h1 className="h-display text-xl">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">{error.message || "The action couldn't finish."}</p>
      {error.digest ? <p className="mt-1 text-xs text-faint">Reference {error.digest}</p> : null}
      <button type="button" className="btn mt-4" onClick={reset}>
        <RotateCcw className="h-4 w-4" aria-hidden /> Try again
      </button>
    </div>
  );
}
