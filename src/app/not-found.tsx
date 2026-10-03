import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md px-4 text-center">
      <p className="h-display text-5xl text-accent">404</p>
      <h1 className="mt-3 text-lg font-semibold">Nothing here</h1>
      <p className="mt-1 text-sm text-muted">That page or item doesn&apos;t exist anymore.</p>
      <Link href="/" className="btn mt-5">
        Back to Today
      </Link>
    </div>
  );
}
