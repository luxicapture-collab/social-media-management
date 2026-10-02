import type { Platform } from "@/domain/types";
import { demoAdapter } from "./demo";
import { linkedinAdapter } from "./linkedin";
import { facebookAdapter, instagramAdapter } from "./meta";
import type { ConnectionCtx, PlatformAdapter } from "./types";
import { xAdapter } from "./x";

const LIVE: Record<Platform, PlatformAdapter> = {
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  linkedin: linkedinAdapter,
  x: xAdapter,
};

const DEMO: Record<Platform, PlatformAdapter> = {
  instagram: demoAdapter("instagram"),
  facebook: demoAdapter("facebook"),
  linkedin: demoAdapter("linkedin"),
  x: demoAdapter("x"),
};

export function adapterFor(platform: Platform, conn: Pick<ConnectionCtx, "mode">): PlatformAdapter {
  return conn.mode === "demo" ? DEMO[platform] : LIVE[platform];
}
