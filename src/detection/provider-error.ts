import type { ErrorCategory } from "../types.js";
import { classifyError } from "./classifier.js";

// Bounds belong to the provider boundary, not the retry/session state machine.
const MAX_JSON_LENGTH = 16384;
const MAX_JSON_DEPTH = 8;
const MAX_ENVELOPE_DEPTH = 4;
const MAX_DECODED_LENGTH = MAX_JSON_LENGTH * 4;

interface ProviderError {
  message: string;
  status?: number;
  response?: { body?: string };
}

function parseEnvelope(text: string): unknown {
  if (text.length > MAX_JSON_LENGTH) return;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") {
      if (++depth > MAX_JSON_DEPTH) return;
    } else if (char === "}" || char === "]") depth--;
  }
  try {
    return JSON.parse(text);
  } catch {
    return;
  }
}

/** Read only error/message envelopes; never search arbitrary serialized payload fields. */
export function classifyProviderError(error: ProviderError): ErrorCategory {
  const codes: string[] = [];
  const messages: string[] = [];
  let remaining = MAX_DECODED_LENGTH;
  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_ENVELOPE_DEPTH) return;
    if (typeof value === "string") {
      if (value.length > MAX_JSON_LENGTH || value.length > remaining) return;
      remaining -= value.length;
      const text = value.trim();
      if (text.startsWith("{") || text.startsWith("[")) {
        visit(parseEnvelope(text), depth + 1);
      } else {
        messages.push(text);
      }
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const envelope = value as Record<string, unknown>;
    if (typeof envelope.code === "string") codes.push(envelope.code);
    visit(envelope.error, depth + 1);
    visit(envelope.message, depth + 1);
  };
  // Body contains the original provider code even when native type is provider.internal.
  if (typeof error.response?.body === "string") {
    visit(parseEnvelope(error.response.body), 0);
  }
  visit(error.message, 0);
  if (codes.includes("claude_session_limit")) return "quota_exceeded";
  // Preserve HTTP and existing text categories; generic native/provider types are not quota.
  const statusCategory = classifyError("", error.status);
  if (statusCategory !== "unknown") return statusCategory;
  for (const message of messages) {
    if (/you've hit your \d+-hour limit\b/i.test(message)) return "quota_exceeded";
    const category = classifyError(message);
    if (category !== "unknown") return category;
  }
  return "unknown";
}
