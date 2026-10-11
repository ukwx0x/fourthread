/**
 * checkpoint_v1.json schema — the portable source of truth for a thread.
 * Field names match the substrate brief exactly:
 * task_intent, next_step, file_watchlist, approvals, parent_session_id.
 */

export interface Turn {
  id: number; // monotonically increasing, assigned by storage
  ts: string; // ISO-8601
  bot: string; // bot id, or "user"
  role: "user" | "assistant";
  content: string;
  model: string | null; // model the bot answered with (null for user turns)
}

export interface CheckpointV1 {
  version: "checkpoint_v1";
  thread_id: string;
  task_intent: string | null;
  next_step: string | null;
  file_watchlist: string[];
  approvals: string[];
  parent_session_id: string | null;
  turns: Turn[];
}

export function emptyCheckpoint(threadId: string): CheckpointV1 {
  return {
    version: "checkpoint_v1",
    thread_id: threadId,
    task_intent: null,
    next_step: null,
    file_watchlist: [],
    approvals: [],
    parent_session_id: null,
    turns: [],
  };
}

export function isCheckpointV1(x: unknown): x is CheckpointV1 {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Record<string, unknown>;
  return (
    c.version === "checkpoint_v1" &&
    typeof c.thread_id === "string" &&
    Array.isArray(c.turns) &&
    Array.isArray(c.file_watchlist) &&
    Array.isArray(c.approvals)
  );
}
