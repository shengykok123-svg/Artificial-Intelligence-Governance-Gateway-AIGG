import type { InspectResponse } from "./types";

const PANEL_ID = "aigg-debug-panel";

function layerName(detector: string): string {
  if (detector === "rules") return "M2 rules";
  if (detector === "embed") return "M8 semantic";
  if (detector === "deberta") return "M9 DeBERTa";
  return detector;
}

function panel(): HTMLDivElement {
  const existing = document.getElementById(PANEL_ID);
  if (existing instanceof HTMLDivElement) return existing;

  const el = document.createElement("div");
  el.id = PANEL_ID;
  el.innerHTML = `
    <style>
      #${PANEL_ID}{position:fixed;z-index:2147483647;top:64px;right:24px;width:286px;max-height:calc(100vh - 88px);overflow:auto;box-sizing:border-box;padding:14px;border:1px solid #334155;border-radius:12px;background:#0f172a;color:#e2e8f0;box-shadow:0 14px 40px rgba(15,23,42,.3);font:12px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}#${PANEL_ID} *{box-sizing:border-box}#${PANEL_ID} .title{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:14px;font-weight:700}#${PANEL_ID} button{border:0;border-radius:6px;padding:3px 7px;color:#cbd5e1;background:#334155;cursor:pointer}#${PANEL_ID} .k{margin-top:9px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:.06em}#${PANEL_ID} .v{margin-top:2px;overflow-wrap:anywhere}#${PANEL_ID} .card{margin-top:7px;padding:8px;border-radius:7px;background:#172033}.allow{color:#86efac}.redact{color:#facc15}.hold{color:#fdba74}.deny{color:#fca5a5}#${PANEL_ID}.collapsed{width:auto;padding:8px 10px}#${PANEL_ID}.collapsed .body{display:none}
    </style>
    <div class="title"><span>AIGG Debug</span><button type="button" aria-label="Collapse debug panel">−</button></div>
    <div class="body"><div class="v">Waiting for an inspected prompt…</div></div>`;
  el.querySelector("button")?.addEventListener("click", () => el.classList.toggle("collapsed"));
  document.documentElement.appendChild(el);
  return el;
}

export function showInspectDebug(result: InspectResponse): void {
  const body = panel().querySelector(".body");
  if (!body) return;
  const department = result.content_department
    ? `${result.content_department} (${(result.department_confidence * 100).toFixed(1)}%)`
    : "none";
  const detections = result.debug.detections.length
    ? result.debug.detections.map((item) => `<div class="card"><b>${layerName(item.detector)}</b> → ${item.data_class}<br><span>confidence ${(item.confidence * 100).toFixed(1)}% · ${item.source}</span></div>`).join("")
    : '<div class="card">No detector matched this prompt.</div>';

  // Never render the raw prompt or matched secret values into ChatGPT.
  body.innerHTML = `<div class="k">Policy result</div><div class="v ${result.decision}"><b>${result.decision.toUpperCase()}</b> · ${result.debug.policy_layer}</div><div class="k">Why</div><div class="v">${result.reason}</div><div class="k">Department</div><div class="v">${department}</div><div class="k">Semantic runtime</div><div class="v">${result.debug.semantic_detector}</div><div class="k">Detector trace</div>${detections}<div class="k">Audit log</div><div class="v">${result.log_id}</div>`;
}

export function showDebugFailure(message: string): void {
  const body = panel().querySelector(".body");
  if (body) body.textContent = `Gateway error: ${message}`;
}
