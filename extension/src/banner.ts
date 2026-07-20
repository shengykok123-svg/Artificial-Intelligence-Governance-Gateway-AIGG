import { PURPOSE_OPTIONS } from "./types";

const BANNER_ID = "aigg-banner";

export type BannerKind =
  | "allow" | "redact" | "hold" | "approved" | "deny" | "denied" | "timeout"
  | "gateway_unavailable" | "redaction_failed" | "unconfigured" | "unsupported_file" | "purpose";

type BannerStyle = { bg: string; fg: string; icon: string; title: string; sent: string };

const STYLE: Record<BannerKind, BannerStyle> = {
  allow: { bg: "#ecfdf5", fg: "#047857", icon: "OK", title: "ALLOW", sent: "Your message has been sent." },
  redact: { bg: "#fffbeb", fg: "#b45309", icon: "!", title: "REDACT & SEND", sent: "Protected content was replaced before sending." },
  hold: { bg: "#fff7ed", fg: "#c2410c", icon: "...", title: "HOLD", sent: "Nothing has been sent." },
  approved: { bg: "#ecfdf5", fg: "#047857", icon: "OK", title: "APPROVED", sent: "Your message has been sent." },
  deny: { bg: "#fef2f2", fg: "#b91c1c", icon: "X", title: "DENY", sent: "Nothing has been sent." },
  denied: { bg: "#fef2f2", fg: "#b91c1c", icon: "X", title: "REVIEW DENIED", sent: "Nothing has been sent." },
  timeout: { bg: "#f8fafc", fg: "#475569", icon: "...", title: "REVIEW PENDING", sent: "Nothing has been sent." },
  gateway_unavailable: { bg: "#f8fafc", fg: "#475569", icon: "!", title: "GATEWAY UNAVAILABLE", sent: "Message sent without gateway verification." },
  redaction_failed: { bg: "#fef2f2", fg: "#b91c1c", icon: "X", title: "REDACTION FAILED", sent: "Nothing has been sent." },
  unconfigured: { bg: "#f8fafc", fg: "#475569", icon: "!", title: "GATEWAY NOT CONFIGURED", sent: "Message sent without gateway verification." },
  unsupported_file: { bg: "#fef2f2", fg: "#b91c1c", icon: "X", title: "UNSUPPORTED ATTACHMENT", sent: "Nothing has been sent." },
  purpose: { bg: "#eff6ff", fg: "#1d4ed8", icon: "?", title: "PURPOSE REQUIRED", sent: "Nothing has been sent." },
};

export function removeBanner(): void {
  document.getElementById(BANNER_ID)?.remove();
}

export function isInsideBanner(node: Node | null): boolean {
  const banner = document.getElementById(BANNER_ID);
  return !!banner && !!node && banner.contains(node);
}

/** Compact feedback card for a verdict. It never includes raw prompt text. */
export function showBanner(_anchor: Element, kind: BannerKind, text: string): void {
  removeBanner();
  const palette = STYLE[kind];
  const card = document.createElement("div");
  card.id = BANNER_ID;
  Object.assign(card.style, {
    position: "fixed", right: "24px", bottom: "24px", zIndex: "2147483647", padding: "12px 14px", margin: "0",
    borderRadius: "10px", minWidth: "280px", maxWidth: "560px", fontSize: "13px",
    fontFamily: "system-ui, sans-serif", lineHeight: "1.4", background: palette.bg, color: palette.fg,
    border: `1px solid ${palette.fg}55`, boxShadow: "0 4px 16px rgba(15, 23, 42, 0.10)",
  });
  const heading = document.createElement("div");
  heading.textContent = `${palette.icon}  ${palette.title}`;
  Object.assign(heading.style, { fontWeight: "700", letterSpacing: "0.02em", paddingRight: "24px" });
  const detail = document.createElement("div");
  detail.textContent = text;
  Object.assign(detail.style, { marginTop: "3px", color: "#1f2937" });
  const outcome = document.createElement("div");
  outcome.textContent = palette.sent;
  Object.assign(outcome.style, { marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${palette.fg}33`, fontWeight: "600" });
  const close = document.createElement("button");
  close.type = "button"; close.textContent = "x"; close.setAttribute("aria-label", "Dismiss governance status");
  Object.assign(close.style, { position: "absolute", right: "8px", top: "5px", border: "0", background: "transparent", color: palette.fg, cursor: "pointer", fontSize: "18px" });
  close.addEventListener("click", removeBanner);
  card.append(heading, detail, outcome, close);
  // Do not attach this to ChatGPT/Gemini's composer. Those SPA frameworks
  // frequently replace the composer tree, and a fixed body-level toast is
  // stable and stays out of the typing area at the lower-right of the page.
  document.body.appendChild(card);
}

function buttonStyle(button: HTMLButtonElement, primary: boolean): void {
  Object.assign(button.style, {
    border: primary ? "1px solid #155eef" : "1px solid #cbd5e1", borderRadius: "7px", padding: "9px 12px",
    background: primary ? "#155eef" : "#fff", color: primary ? "#fff" : "#334155", cursor: "pointer", fontWeight: "700",
  });
}

/**
 * A real in-page purpose confirmation overlay. The returned value is the
 * policy-recognised category (not the free text); this preserves M3's exact
 * purpose matching. The explanatory text is deliberately not sent because
 * the current API/audit schema has no `justification` field yet.
 */
export function showPurposePicker(_anchor: Element): Promise<string | null> {
  return new Promise((resolve) => {
    removeBanner();
    const overlay = document.createElement("div");
    overlay.id = BANNER_ID;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Justification required");
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", zIndex: "2147483647", background: "rgba(15, 23, 42, .48)",
      display: "grid", placeItems: "center", padding: "16px", fontFamily: "system-ui, sans-serif",
    });
    const panel = document.createElement("section");
    Object.assign(panel.style, {
      width: "min(620px, calc(100vw - 32px))", maxHeight: "calc(100vh - 32px)", overflowY: "auto",
      background: "#fff", borderRadius: "16px", padding: "26px", color: "#17223b", boxShadow: "0 24px 70px rgba(15, 23, 42, .35)",
    });
    const title = document.createElement("h2");
    title.textContent = "Justification required";
    Object.assign(title.style, { margin: "0", fontSize: "22px" });
    const intro = document.createElement("p");
    intro.textContent = "Potentially sensitive business information was detected. State the authorised purpose before this request is checked again.";
    Object.assign(intro.style, { color: "#475569", lineHeight: "1.5", margin: "8px 0 18px" });
    const purposeLabel = document.createElement("label");
    purposeLabel.textContent = "Purpose of use *";
    Object.assign(purposeLabel.style, { display: "block", fontWeight: "700", marginBottom: "6px" });
    const explanation = document.createElement("textarea");
    explanation.maxLength = 500; explanation.placeholder = "Example: Summarise this internal document for an authorised engineering project update.";
    Object.assign(explanation.style, { boxSizing: "border-box", width: "100%", minHeight: "88px", padding: "10px", border: "1px solid #b8c6da", borderRadius: "8px", font: "inherit", resize: "vertical" });
    const categoryLabel = document.createElement("label");
    categoryLabel.textContent = "Business category *";
    Object.assign(categoryLabel.style, { display: "block", fontWeight: "700", margin: "16px 0 6px" });
    const category = document.createElement("select");
    Object.assign(category.style, { width: "100%", padding: "10px", border: "1px solid #b8c6da", borderRadius: "8px", font: "inherit", background: "#fff" });
    for (const option of PURPOSE_OPTIONS) {
      const item = document.createElement("option"); item.value = option.value; item.textContent = option.label; category.appendChild(item);
    }
    const notice = document.createElement("div");
    notice.textContent = "What happens next? The selected purpose category is recorded and this same request is sent to policy for a second decision. No content has been sent yet.";
    Object.assign(notice.style, { marginTop: "16px", padding: "11px", borderRadius: "8px", background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", lineHeight: "1.45" });
    const acknowledgements = [
      "This request is required for an authorised business purpose.",
      "I understand that this activity will be recorded and may be reviewed.",
      "I am responsible for ensuring this information is appropriate to share with this AI tool.",
    ];
    const checks: HTMLInputElement[] = [];
    const checkArea = document.createElement("div");
    Object.assign(checkArea.style, { marginTop: "16px", display: "grid", gap: "9px" });
    for (const text of acknowledgements) {
      const label = document.createElement("label"); Object.assign(label.style, { display: "flex", gap: "9px", alignItems: "flex-start", lineHeight: "1.4" });
      const check = document.createElement("input"); check.type = "checkbox"; checks.push(check);
      const copy = document.createElement("span"); copy.textContent = text; label.append(check, copy); checkArea.appendChild(label);
    }
    const error = document.createElement("div");
    Object.assign(error.style, { minHeight: "19px", color: "#b91c1c", marginTop: "12px", fontSize: "13px" });
    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" });
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; buttonStyle(cancel, false);
    const confirm = document.createElement("button"); confirm.type = "button"; confirm.textContent = "Confirm and continue"; buttonStyle(confirm, true);
    const close = (): void => { removeBanner(); resolve(null); };
    cancel.addEventListener("click", close);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
    confirm.addEventListener("click", () => {
      if (!explanation.value.trim()) { error.textContent = "Enter a short authorised business purpose."; explanation.focus(); return; }
      if (!checks.every((check) => check.checked)) { error.textContent = "Confirm all three acknowledgements before continuing."; return; }
      removeBanner();
      resolve(category.value);
    });
    panel.append(title, intro, purposeLabel, explanation, categoryLabel, category, notice, checkArea, error, actions);
    actions.append(cancel, confirm); overlay.appendChild(panel); document.body.appendChild(overlay); explanation.focus();
  });
}
