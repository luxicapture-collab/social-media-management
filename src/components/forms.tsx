"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { createContext, startTransition, useActionState, useContext, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";

const PendingContext = createContext(false);

export function SubmitButton({ children, className, pendingText }: { children: ReactNode; className?: string; pendingText?: string }) {
  const { pending: formPending } = useFormStatus();
  const pending = useContext(PendingContext) || formPending;
  return (
    <button type="submit" className={clsx("btn", className)} disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/**
 * A form bound to a server action returning ActionState; shows the result inline.
 * Submitted via onSubmit rather than the `action` prop so React doesn't reset the fields after
 * every submission — a validation error keeps what was typed. With resetOnSuccess the fields
 * clear only after a successful save.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(async (prev: ActionState & { saves: number }, fd: FormData) => {
    const result = await action(prev, fd);
    return { ...result, saves: prev.saves + (result.ok ? 1 : 0) };
  }, { saves: 0 });

  return (
    <PendingContext.Provider value={pending}>
      <form
        key={resetOnSuccess ? `saved-${state.saves}` : undefined}
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          const submitter = (e.nativeEvent as SubmitEvent).submitter;
          let fd: FormData;
          try {
            fd = new FormData(e.currentTarget, submitter);
          } catch {
            fd = new FormData(e.currentTarget);
          }
          startTransition(() => formAction(fd));
        }}
      >
        {children}
        {state.error ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.ok && state.message ? (
          <p className="mt-2 text-sm text-success" role="status">
            {state.message}
          </p>
        ) : null}
      </form>
    </PendingContext.Provider>
  );
}

/** One-click action button (server action without form fields). */
export function ActionButton({
  action,
  children,
  className,
  confirm,
}: {
  action: () => Promise<unknown>;
  children: ReactNode;
  className?: string;
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={clsx("btn", className)}
      disabled={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          await action();
        });
      }}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
