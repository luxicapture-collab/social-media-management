"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkCredentials, startSession } from "@/server/auth/dal";
import { safeNextPath } from "@/server/auth/session";

export async function loginAction(_prev: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  const email = String(fd.get("email") ?? "");
  const password = String(fd.get("password") ?? "");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const result = checkCredentials(email, password, ip);
  if (!result.ok) return { error: result.error };
  await startSession(email);
  redirect(safeNextPath(String(fd.get("next") ?? "/")));
}
