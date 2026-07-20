// Popup is intentionally a safe operational summary: never render prompt text
// or matched values here. The in-page debug panel remains the developer view.

interface StoredConfig {
  baseUrl?: string;
  userId?: string;
  apiKey?: string;
  mockMode?: boolean;
  lastVerdict?: { decision: string; reason: string; ts: number };
}

interface HealthResponse {
  status: string;
  semantic_detector?: string;
  semantic_submodules?: string[];
  mocked?: string[];
}

const DEFAULTS = {
  baseUrl: "http://localhost:8000",
  userId: "wei.eng@acme.my",
  apiKey: "dev-key-change-me",
  mockMode: false,
};

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function setLinks(baseUrl: string): void {
  const root = normalizedBaseUrl(baseUrl);
  el<HTMLAnchorElement>("m9TesterLink").href = `${root}/m9-tester/`;
  el<HTMLAnchorElement>("dashboardLink").href = `${root.replace(/:8000$/, ":5173")}`;
}

function ago(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function renderLastDecision(last?: StoredConfig["lastVerdict"]): void {
  const target = el<HTMLDivElement>("lastDecision");
  if (!last) {
    target.textContent = "No gateway decision yet.";
    return;
  }
  target.textContent = `${last.decision.toUpperCase()} — ${last.reason}`;
  const age = document.createElement("small");
  age.textContent = ago(last.ts);
  target.appendChild(age);
}

function moduleRow(name: string, state: string, className = ""): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "module";
  const label = document.createElement("span");
  label.textContent = name;
  const chip = document.createElement("span");
  chip.className = `chip ${className}`.trim();
  chip.textContent = state;
  row.append(label, chip);
  return row;
}

function renderModules(body: HealthResponse): void {
  const mocked = new Set(body.mocked ?? []);
  const modules = el<HTMLDivElement>("modules");
  modules.replaceChildren(
    moduleRow("Semantic runtime", body.semantic_detector === "both" ? "M8 + M9" : body.semantic_detector ?? "Unknown", "active"),
    moduleRow("M2 Structured detection", mocked.has("M2") ? "Mock" : "Active", mocked.has("M2") ? "mock" : "active"),
    moduleRow("M9 NLP classification", body.semantic_detector === "m8" ? "Disabled" : "DeBERTa", body.semantic_detector === "m8" ? "" : "active"),
    moduleRow("M8 Vector similarity", body.semantic_detector === "m9_deberta" ? "Disabled" : "Active", body.semantic_detector === "m9_deberta" ? "" : "active"),
    moduleRow("Policy engine (M3)", mocked.has("M3") ? "Mock" : "Active", mocked.has("M3") ? "mock" : "active"),
  );
}

function setHealth(ok: boolean, title: string, note: string): void {
  const health = el<HTMLDivElement>("health");
  health.classList.toggle("error", !ok);
  el<HTMLDivElement>("healthTitle").textContent = title;
  el<HTMLDivElement>("healthNote").textContent = note;
  el<HTMLSpanElement>("connectionText").textContent = ok ? "Reachable" : "Needs attention";
}

async function checkHealth(baseUrl: string, apiKey: string, last?: StoredConfig["lastVerdict"]): Promise<void> {
  try {
    const started = performance.now();
    const res = await fetch(`${normalizedBaseUrl(baseUrl)}/v1/health`, { headers: { "X-Api-Key": apiKey } });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as HealthResponse;
    const latency = Math.round(performance.now() - started);
    const mocked = body.mocked ?? [];
    // /v1/health proves only that the API process is reachable. It cannot
    // prove that model loading, M3, or POST /v1/inspect succeeds.
    if (last?.decision === "error") {
      setHealth(false, "Gateway reachable — inspection error", last.reason);
    } else {
      setHealth(true, "Gateway reachable", mocked.length ? `Health endpoint responded in ${latency}ms · mock: ${mocked.join(", ")}` : `Health endpoint responded in ${latency}ms`);
    }
    renderModules(body);
  } catch {
    setHealth(false, "Gateway unavailable", "The current MVP fails open when the local gateway cannot be reached.");
    el<HTMLDivElement>("modules").replaceChildren(moduleRow("Runtime", "Offline", "mock"));
  }
}

async function load(): Promise<void> {
  const stored = (await chrome.storage.local.get(["baseUrl", "userId", "apiKey", "mockMode", "lastVerdict"])) as StoredConfig;
  const baseUrl = stored.baseUrl ?? DEFAULTS.baseUrl;
  const userId = stored.userId ?? DEFAULTS.userId;
  const apiKey = stored.apiKey ?? DEFAULTS.apiKey;
  el<HTMLInputElement>("baseUrl").value = baseUrl;
  el<HTMLInputElement>("userId").value = userId;
  el<HTMLInputElement>("apiKey").value = apiKey;
  el<HTMLInputElement>("mockMode").checked = stored.mockMode ?? DEFAULTS.mockMode;
  el<HTMLSpanElement>("configuredUser").textContent = userId;
  setLinks(baseUrl);
  renderLastDecision(stored.lastVerdict);
  void checkHealth(baseUrl, apiKey, stored.lastVerdict);
}

el<HTMLButtonElement>("save").addEventListener("click", () => {
  void (async () => {
    const baseUrl = el<HTMLInputElement>("baseUrl").value.trim() || DEFAULTS.baseUrl;
    const userId = el<HTMLInputElement>("userId").value.trim() || DEFAULTS.userId;
    const apiKey = el<HTMLInputElement>("apiKey").value.trim() || DEFAULTS.apiKey;
    const mockMode = el<HTMLInputElement>("mockMode").checked;
    await chrome.storage.local.set({ baseUrl, userId, apiKey, mockMode });
    el<HTMLSpanElement>("configuredUser").textContent = userId;
    setLinks(baseUrl);
    el<HTMLDivElement>("saveNote").textContent = "Settings saved.";
    void checkHealth(baseUrl, apiKey);
  })();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lastVerdict) {
    const last = changes.lastVerdict.newValue as StoredConfig["lastVerdict"];
    renderLastDecision(last);
    if (last?.decision === "error") setHealth(false, "Gateway reachable — inspection error", last.reason);
  }
});

void load();
