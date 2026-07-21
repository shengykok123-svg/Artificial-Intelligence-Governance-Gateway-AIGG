// M4  Service worker. Owns ALL network calls: POST IF-2, poll IF-3, X-Api-Key header, API base URL from chrome.storage.
//
// The content script never fetches. Everything that talks to the API, or to
// chrome.storage for config, lives here so there is exactly one place that
// knows the base URL, the key, and the user_id.

import type {
  BackgroundMessage,
  Decision,
  ExtensionMessage,
  InspectMessage,
  InspectOutcome,
  InspectRequest,
  InspectResponse,
  InspectStatusResponse,
  LogStatus,
} from "./types";
import { mockPollUntilResolved, nextMockOutcome } from "./mock";
import { AI_HOSTS } from "./ai_hosts";

// user_id <- chrome.storage, defaulted to a seeded user. IF-1 carries no
// user_id but IF-2 requires one; without a default, a fresh unpacked build
// 403s on every prompt and looks broken. Never role or department -- those
// come from the users table (SD-2), never a self-asserted header.
const DEFAULT_BASE_URL = "http://localhost:8000";
const DEFAULT_USER_ID = "wei.eng@acme.my";
const DEFAULT_API_KEY = "dev-key-change-me";

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;

interface Config {
  baseUrl: string;
  userId: string;
  apiKey: string;
  mockMode: boolean;
}

interface LastVerdict {
  decision: Decision | "error";
  reason: string;
  ts: number;
}

async function getConfig(): Promise<Config> {
  const stored = await chrome.storage.local.get(["baseUrl", "userId", "apiKey", "mockMode"]);
  return {
    baseUrl: (stored.baseUrl as string | undefined) ?? DEFAULT_BASE_URL,
    userId: (stored.userId as string | undefined) ?? DEFAULT_USER_ID,
    apiKey: (stored.apiKey as string | undefined) ?? DEFAULT_API_KEY,
    mockMode: (stored.mockMode as boolean | undefined) ?? false,
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(["baseUrl", "userId", "apiKey", "mockMode"]);
  await chrome.storage.local.set({
    baseUrl: existing.baseUrl ?? DEFAULT_BASE_URL,
    userId: existing.userId ?? DEFAULT_USER_ID,
    apiKey: existing.apiKey ?? DEFAULT_API_KEY,
    mockMode: existing.mockMode ?? false,
  });
  chrome.action.setBadgeText({ text: "" });
});

const BADGE_COLOR: Record<Decision | "error", string> = {
  allow: "#16a34a",
  redact: "#f59e0b",
  hold: "#eab308",
  deny: "#dc2626",
  error: "#6b7280",
};

async function setLastVerdict(v: LastVerdict): Promise<void> {
  await chrome.storage.local.set({ lastVerdict: v });
  chrome.action.setBadgeText({ text: v.decision.slice(0, 1).toUpperCase() });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR[v.decision] });
}

class UnconfiguredError extends Error {}
class UnsupportedFileError extends Error {}

async function safeDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    return body.detail ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

async function callInspect(config: Config, req: InspectRequest): Promise<InspectResponse> {
  const res = await fetch(`${config.baseUrl}/v1/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": config.apiKey },
    body: JSON.stringify(req),
  });
  if (res.status === 403) throw new UnconfiguredError(await safeDetail(res));
  if (res.status === 415) throw new UnsupportedFileError(await safeDetail(res));
  if (!res.ok) throw new Error(`POST /v1/inspect -> HTTP ${res.status}`);
  return (await res.json()) as InspectResponse;
}

async function fetchStatus(config: Config, logId: string): Promise<InspectStatusResponse> {
  const res = await fetch(`${config.baseUrl}/v1/inspect/${logId}`, {
    headers: { "X-Api-Key": config.apiKey },
  });
  if (!res.ok) throw new Error(`GET /v1/inspect/${logId} -> HTTP ${res.status}`);
  return (await res.json()) as InspectStatusResponse;
}

/** Poll IF-3 every 3s for up to 5 minutes. Returns "pending" on timeout. */
async function pollUntilResolved(
  config: Config, logId: string,
): Promise<{ status: LogStatus; redactedPrompt?: string | null }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    try {
      const status = await fetchStatus(config, logId);
      if (status.status !== "pending") {
        return { status: status.status, redactedPrompt: status.redacted_prompt };
      }
    } catch {
      // transient network hiccup mid-poll -- keep trying until the deadline
    }
  }
  return { status: "pending" }; // still pending when the window ran out
}

function notifyHoldResolved(
  tabId: number, logId: string, status: LogStatus, redactedPrompt?: string | null,
): void {
  const message: BackgroundMessage = {
    type: "HOLD_RESOLVED", log_id: logId, status, redacted_prompt: redactedPrompt,
  };
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // tab navigated away or closed while we were polling -- nothing to unblock
  });
}

async function handleInspect(
  message: InspectMessage,
  tabId: number | undefined,
): Promise<InspectOutcome> {
  const config = await getConfig();

  if (config.mockMode) {
    const result = await nextMockOutcome(message.prompt);
    await setLastVerdict({ decision: result.decision, reason: result.reason, ts: Date.now() });
    if (result.decision === "hold" && tabId !== undefined) {
      mockPollUntilResolved().then((status) => notifyHoldResolved(tabId, result.log_id, status));
    }
    return { ok: true, result };
  }

  let result: InspectResponse;
  try {
    result = await callInspect(config, {
      user_id: config.userId,
      target_host: message.targetHost,
      prompt: message.prompt,
      purpose: message.purpose ?? "GENERAL",
      attachments: message.files,
      existing_log_id: message.existingLogId ?? null,
      justification: message.justification ?? null,
    });
  } catch (err) {
    if (err instanceof UnconfiguredError) {
      await setLastVerdict({ decision: "error", reason: "unknown user_id -- extension not configured", ts: Date.now() });
      return { ok: false, reason: "unconfigured", message: err.message };
    }
    if (err instanceof UnsupportedFileError) {
      await setLastVerdict({ decision: "error", reason: "attachment could not be read", ts: Date.now() });
      return { ok: false, reason: "unsupported_file", message: err.message };
    }
    // Network unreachable, timed out, or a 5xx: fail OPEN. A gateway that
    // bricks the composer when the backend blinks does not survive a demo,
    // and blocking here would mean the tool itself becomes the bypass.
    console.warn("[aigg] backend unreachable, failing open:", err);
    await setLastVerdict({ decision: "error", reason: "backend unreachable -- failed open", ts: Date.now() });
    return { ok: false, reason: "unreachable", message: String(err) };
  }

  await setLastVerdict({ decision: result.decision, reason: result.reason, ts: Date.now() });

  if (result.decision === "hold" && tabId !== undefined) {
    pollUntilResolved(config, result.log_id).then(({ status, redactedPrompt }) =>
      notifyHoldResolved(tabId, result.log_id, status, redactedPrompt),
    );
  }

  return { ok: true, result };
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === "INSPECT") {
    handleInspect(message, sender.tab?.id).then(sendResponse);
    return true; // keep the channel open for the async response
  }

  if (message.type === "CHECK_HOLD_STATUS") {
    void (async () => {
      const config = await getConfig();
      try {
        const status = await fetchStatus(config, message.log_id);
        sendResponse(status);
      } catch (err) {
        console.warn("[aigg] hold status check failed:", err);
        sendResponse({ decision: "hold", status: "pending" });
      }
    })();
    return true; // keep the channel open for the async response
  }

  return false;
});

// --------------------------------------------------------------------------
// Shadow-AI discovery: unlike chatgpt.com/gemini.google.com (real content
// scripts, real prompt inspection), the ~2,200 hosts in AI_HOSTS get no DOM
// integration at all -- there's no per-site selector work for tools we've
// never customized. Without that, there is no reliable way to tell "the
// user sent a prompt" apart from "the page did its own background XHR/fetch
// calls" -- confirmed concretely on poe.com, whose own page load fires 3
// POST requests to a generic /api/receive_POST endpoint before a user types
// anything, indistinguishable by method or resource type from a real
// message send. So instead of watching network traffic at all, this uses
// chrome.webNavigation.onCompleted -- the browser's own top-level-navigation
// lifecycle signal, not a request-layer one -- to fire "this tool was
// opened" exactly once per page the user actually lands on.
//
// This deliberately replaced an earlier chrome.webRequest.onCompleted (type
// === "main_frame") version: it looked equivalent, but requests fetched via
// Chrome's own prerendering (e.g. omnibox-predicted navigation to sites like
// perplexity.ai's Next.js app) don't reliably surface through webRequest the
// same way once the tab activates the prerendered page, so some real visits
// silently never fired. webNavigation tracks navigation state directly and
// fires on activation regardless of how the underlying document was
// fetched (network, cache, or prerender), so it doesn't have that gap.
// Coarser than a per-prompt counter -- multiple prompts in one open tab/chat
// only count as the one visit that opened it -- but it's an honest, stable
// signal instead of one that jumps around based on how chatty a given
// site's background traffic happens to be. manifest.json declares
// host_permissions for exactly these hosts (not <all_urls>).
// --------------------------------------------------------------------------

const REAL_TRACKED_HOSTS = new Set(["chatgpt.com", "gemini.google.com"]);
// Safety net only, not a burst-collapsing window: a single top-level
// navigation should fire onCompleted once, but this guards against edge
// cases (e.g. a site issuing its own immediate reload) double-pinging.
// Keyed by tab + host so two tabs open on the same shadow-AI site are
// tracked independently instead of one tab's load suppressing the other's.
const VISIT_DEBOUNCE_MS = 3_000;
const lastVisitPingByTabHost = new Map<string, number>();

async function postToolVisit(config: Config, host: string): Promise<void> {
  try {
    const res = await fetch(`${config.baseUrl}/v1/tools/visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": config.apiKey },
      body: JSON.stringify({ host }),
    });
    if (!res.ok) console.warn(`[aigg] POST /v1/tools/visit -> HTTP ${res.status}`);
  } catch (err) {
    // Fail silent+open, same posture as the rest of this file -- a shadow-AI
    // discovery ping must never affect page load or composer use.
    console.warn("[aigg] tool visit ping failed:", err);
  }
}

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return; // top-level frame only, not iframes

  let hostname: string;
  try {
    hostname = new URL(details.url).hostname.toLowerCase();
  } catch {
    return;
  }

  if (REAL_TRACKED_HOSTS.has(hostname)) return; // already tracked via inspect()
  if (!AI_HOSTS.has(hostname)) return; // not a tracked shadow-AI host

  const key = `${details.tabId}:${hostname}`;
  const now = Date.now();
  const last = lastVisitPingByTabHost.get(key) ?? 0;
  if (now - last < VISIT_DEBOUNCE_MS) return;
  lastVisitPingByTabHost.set(key, now);

  void (async () => {
    const config = await getConfig();
    if (config.mockMode) return; // mock mode never talks to a real backend
    await postToolVisit(config, hostname);
  })();
});
