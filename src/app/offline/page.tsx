export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent font-display text-2xl font-bold text-accent-fg">L</span>
        <h1 className="h-display mt-4 text-2xl">You&apos;re offline</h1>
        <p className="mt-2 max-w-xs text-sm text-muted">The agent keeps working on the server. Reconnect to see approvals, the calendar and the inbox.</p>
      </div>
    </main>
  );
}
