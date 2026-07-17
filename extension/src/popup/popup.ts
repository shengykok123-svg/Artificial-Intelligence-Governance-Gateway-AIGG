// M4  Badge showing the last verdict + link to the dashboard.

interface StoredConfig {
  baseUrl?: string;
  userId?: string;
  apiKey?: string;
  mockMode?: boolean;
  lastVerdict?: { decision: string; reason: string; ts: number };
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

async function load(): Promise<void> {
  const stored = (await chrome.storage.local.get([
    "baseUrl",
    "userId",
    "apiKey",
    "mockMode",
    "lastVerdict",
  ])) as StoredConfig;

  el<HTMLInputElement>("baseUrl").value = stored.baseUrl ?? DEFAULTS.baseUrl;
  el<HTMLInputElement>("userId").value = stored.userId ?? DEFAULTS.userId;
  el<HTMLInputElement>("apiKey").value = stored.apiKey ?? DEFAULTS.apiKey;
  el<HTMLInputElement>("mockMode").checked = stored.mockMode ?? DEFAULTS.mockMode;

  renderStatus(stored.lastVerdict);
  void checkHealth(stored.baseUrl ?? DEFAULTS.baseUrl, stored.apiKey ?? DEFAULTS.apiKey);
}

function renderStatus(lastVerdict: StoredConfig["lastVerdict"]): void {
  const target = el<HTMLDivElement>("status");
  if (!lastVerdict) {
    target.textContent = "no verdict yet";
    return;
  }
  const age = Math.max(0, Math.round((Date.now() - lastVerdict.ts) / 1000));
  target.textContent = `${lastVerdict.decision.toUpperCase()} - ${lastVerdict.reason} (${age}s ago)`;
}

async function checkHealth(baseUrl: string, apiKey: string): Promise<void> {
  const warn = el<HTMLDivElement>("mockWarning");
  try {
    const res = await fetch(`${baseUrl}/v1/health`, { headers: { "X-Api-Key": apiKey } });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { status: string; mocked: string[] };
    if (body.mocked?.length) {
      warn.style.display = "block";
      warn.textContent = `Backend is mocking: ${body.mocked.join(", ")}. Verdicts only reflect the trigger strings until these land.`;
    } else {
      warn.style.display = "none";
    }
  } catch {
    warn.style.display = "block";
    warn.textContent = "Backend unreachable -- the extension fails OPEN (prompts pass through unchecked) until it comes back.";
  }
}

el<HTMLButtonElement>("save").addEventListener("click", () => {
  void (async () => {
    const baseUrl = el<HTMLInputElement>("baseUrl").value.trim() || DEFAULTS.baseUrl;
    const userId = el<HTMLInputElement>("userId").value.trim() || DEFAULTS.userId;
    const apiKey = el<HTMLInputElement>("apiKey").value.trim() || DEFAULTS.apiKey;
    const mockMode = el<HTMLInputElement>("mockMode").checked;
    await chrome.storage.local.set({ baseUrl, userId, apiKey, mockMode });
    void checkHealth(baseUrl, apiKey);
  })();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lastVerdict) {
    renderStatus(changes.lastVerdict.newValue as StoredConfig["lastVerdict"]);
  }
});

void load();
