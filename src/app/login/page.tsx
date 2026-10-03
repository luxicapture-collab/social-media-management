import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/dal";
import { safeNextPath } from "@/server/auth/session";
import { config } from "@/server/config";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next);
  if (await currentUser()) redirect(safeNext);
  const cfg = config();
  const devLogin = !cfg.isProd && !process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_HASH;

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent font-display text-2xl font-bold text-accent-fg">L</span>
          <h1 className="h-display mt-4 text-3xl">Luxi Agent</h1>
          <p className="mt-1 text-sm text-muted">{cfg.agencyName} · social media team</p>
        </div>
        <div className="card card-pad">
          <LoginForm next={safeNext} defaultEmail={devLogin ? cfg.admin.email : undefined} />
        </div>
        {devLogin ? (
          <p className="mt-4 text-center text-xs text-faint">
            Development login: <span className="text-muted">{cfg.admin.email}</span> / <span className="text-muted">luxi-demo</span>. Set ADMIN_EMAIL and ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH) before deploying.
          </p>
        ) : null}
      </div>
    </main>
  );
}
