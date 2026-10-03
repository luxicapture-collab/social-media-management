"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { validateCaption, xWeightedLength } from "@/domain/captions";
import { CAPTION_RULES } from "@/domain/platform-specs";
import type { Captions } from "@/domain/schemas";
import type { Format, Platform } from "@/domain/types";
import { PLATFORM_LABEL } from "@/domain/types";

/**
 * Per-platform caption tabs with the same rule checks the agent runs (length, fold, hashtags,
 * links, clichés). Field names are caption_<platform> so the enclosing form can submit them.
 */
export function CaptionEditor({ captions, platforms, format, readOnly }: { captions: Captions; platforms: Platform[]; format: Format; readOnly?: boolean }) {
  const shown = platforms.length ? platforms : (["instagram"] as Platform[]);
  const [tab, setTab] = useState<Platform>(shown[0]);
  const [values, setValues] = useState<Captions>(captions);

  const issues = useMemo(() => validateCaption(tab, values[tab] ?? "", { format }), [tab, values, format]);
  const count = tab === "x" ? xWeightedLength(values[tab] ?? "") : [...(values[tab] ?? "")].length;
  const limit = CAPTION_RULES[tab].maxChars;

  if (format === "story") {
    return <p className="text-sm text-muted">Stories carry no caption — the words are on screen (see story frames).</p>;
  }

  return (
    <div>
      <div className="mb-2 flex gap-1 overflow-x-auto scrollbar-none" role="tablist">
        {shown.map((p) => {
          const pIssues = validateCaption(p, values[p] ?? "", { format });
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={tab === p}
              onClick={() => setTab(p)}
              className={clsx("btn btn-sm", tab === p ? "border-accent text-fg" : "text-muted")}
            >
              {PLATFORM_LABEL[p]}
              {pIssues.some((i) => i.severity === "error") ? <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-label="has errors" /> : pIssues.length ? <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-label="has warnings" /> : null}
            </button>
          );
        })}
      </div>
      {shown.map((p) => (
        <textarea
          key={p}
          name={`caption_${p}`}
          dir="auto"
          readOnly={readOnly}
          className={clsx("input min-h-44 font-[inherit] leading-relaxed", tab === p ? "block" : "hidden")}
          value={values[p] ?? ""}
          onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))}
        />
      ))}
      <div className="mt-1.5 flex flex-wrap items-start justify-between gap-2 text-xs">
        <ul className="space-y-0.5">
          {issues.map((i) => (
            <li key={i.code + i.message} className={i.severity === "error" ? "text-danger" : "text-warning"}>
              {i.severity === "error" ? "✕" : "!"} {i.message}
            </li>
          ))}
          {!issues.length ? <li className="text-success">✓ Fits {PLATFORM_LABEL[tab]}&apos;s rules</li> : null}
        </ul>
        <span className={clsx("tabular-nums", count > limit ? "text-danger" : "text-faint")}>
          {count.toLocaleString()} / {limit.toLocaleString()}
          {tab === "x" ? " weighted" : ""}
        </span>
      </div>
    </div>
  );
}
