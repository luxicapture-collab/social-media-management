"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useState } from "react";
import { loginAction } from "./actions";

export function LoginForm({ next, defaultEmail }: { next: string; defaultEmail?: string }) {
  const [state, action, pending] = useActionState(loginAction, {});
  // Controlled so a failed attempt (React resets the form after each action) keeps the email.
  const [email, setEmail] = useState(defaultEmail ?? "");
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      {state.error ? (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        Sign in
      </button>
    </form>
  );
}
