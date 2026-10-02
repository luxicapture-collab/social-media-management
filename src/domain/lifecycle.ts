import type { ContentStatus } from "./types";

/**
 * Allowed content status transitions. Two hard gates live here:
 *  - nothing is produced (credits spent) before a human green-lights the concept + quote;
 *  - nothing is scheduled before a human approves the finished cut.
 */
export const TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  concept: ["greenlit", "revise", "dropped"],
  greenlit: ["producing", "concept", "dropped"],
  producing: ["review", "failed", "concept"],
  review: ["approved", "revise", "dropped", "producing"],
  approved: ["scheduled", "review", "dropped"],
  scheduled: ["live", "failed", "review", "dropped"],
  live: ["analyzed"],
  analyzed: [],
  revise: ["concept", "producing", "review", "dropped"],
  failed: ["greenlit", "review", "producing", "dropped"],
  dropped: ["concept"],
};

/** Transitions only a human may trigger from the UI. */
export const HUMAN_TRANSITIONS: ReadonlyArray<[ContentStatus, ContentStatus]> = [
  ["concept", "greenlit"],
  ["concept", "revise"],
  ["concept", "dropped"],
  ["greenlit", "dropped"],
  ["review", "approved"],
  ["review", "revise"],
  ["review", "dropped"],
  ["approved", "dropped"],
  ["scheduled", "review"],
  ["scheduled", "dropped"],
  ["failed", "greenlit"],
  ["failed", "dropped"],
  ["dropped", "concept"],
];

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class TransitionError extends Error {
  constructor(
    readonly from: ContentStatus,
    readonly to: ContentStatus,
  ) {
    super(`Content cannot move from "${from}" to "${to}"`);
    this.name = "TransitionError";
  }
}

export function assertTransition(from: ContentStatus, to: ContentStatus): void {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

export function isHumanTransition(from: ContentStatus, to: ContentStatus): boolean {
  return HUMAN_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/** Statuses that are waiting on the human. */
export const WAITING_ON_HUMAN: readonly ContentStatus[] = ["concept", "review"];

/** Statuses the agent is expected to move forward on its own. */
export const AGENT_OWNED: readonly ContentStatus[] = ["greenlit", "producing", "revise", "approved", "scheduled", "live"];
