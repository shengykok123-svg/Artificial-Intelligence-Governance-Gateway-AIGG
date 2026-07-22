import { PURPOSE_OPTIONS } from "./types";

const BANNER_ID = "aigg-banner";

export type BannerKind =
  | "allow" | "redact" | "hold" | "approved" | "deny" | "denied" | "timeout"
  | "gateway_unavailable" | "redaction_failed" | "unconfigured" | "unsupported_file" | "purpose"
  | "checking";

type BannerStyle = {
  bg: string;
  border: string;
  titleColor: string;
  detailColor: string;
  iconBg: string;
  iconSvg: string;
  title: string;
  sent: string;
};

const SVG_CHECK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const SVG_WARN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path></svg>`;
const SVG_CLOCK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
const SVG_CROSS = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
const SVG_INFO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
const SVG_QUESTION = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
const SVG_SPINNER = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: aigg-spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>`;

const STYLE: Record<BannerKind, BannerStyle> = {
  checking: {
    bg: "#f0f9ff", border: "#bae6fd", titleColor: "#0284c7", detailColor: "#1f2937",
    iconBg: "#0284c7", iconSvg: SVG_SPINNER, title: "CHECKING", sent: "Verification in progress..."
  },
  allow: {
    bg: "#f0faf4", border: "#bbf7d0", titleColor: "#15803d", detailColor: "#1f2937",
    iconBg: "#16a34a", iconSvg: SVG_CHECK, title: "ALLOW", sent: "Your message has been sent."
  },
  approved: {
    bg: "#f0faf4", border: "#bbf7d0", titleColor: "#15803d", detailColor: "#1f2937",
    iconBg: "#16a34a", iconSvg: SVG_CHECK, title: "APPROVED", sent: "Your message has been sent."
  },
  redact: {
    bg: "#fffbeb", border: "#fde68a", titleColor: "#b45309", detailColor: "#1f2937",
    iconBg: "#d97706", iconSvg: SVG_WARN, title: "REDACT & SEND", sent: "Protected content was replaced before sending."
  },
  hold: {
    bg: "#fff7ed", border: "#fed7aa", titleColor: "#c2410c", detailColor: "#1f2937",
    iconBg: "#ea580c", iconSvg: SVG_CLOCK, title: "HOLD", sent: "Nothing has been sent."
  },
  timeout: {
    bg: "#f8fafc", border: "#e2e8f0", titleColor: "#475569", detailColor: "#1f2937",
    iconBg: "#64748b", iconSvg: SVG_CLOCK, title: "REVIEW PENDING", sent: "Nothing has been sent."
  },
  deny: {
    bg: "#fef2f2", border: "#fecaca", titleColor: "#b91c1c", detailColor: "#1f2937",
    iconBg: "#dc2626", iconSvg: SVG_CROSS, title: "DENY", sent: "Nothing has been sent."
  },
  denied: {
    bg: "#fef2f2", border: "#fecaca", titleColor: "#b91c1c", detailColor: "#1f2937",
    iconBg: "#dc2626", iconSvg: SVG_CROSS, title: "REVIEW DENIED", sent: "Nothing has been sent."
  },
  redaction_failed: {
    bg: "#fef2f2", border: "#fecaca", titleColor: "#b91c1c", detailColor: "#1f2937",
    iconBg: "#dc2626", iconSvg: SVG_CROSS, title: "REDACTION FAILED", sent: "Nothing has been sent."
  },
  unsupported_file: {
    bg: "#fef2f2", border: "#fecaca", titleColor: "#b91c1c", detailColor: "#1f2937",
    iconBg: "#dc2626", iconSvg: SVG_CROSS, title: "UNSUPPORTED ATTACHMENT", sent: "Nothing has been sent."
  },
  gateway_unavailable: {
    bg: "#f8fafc", border: "#e2e8f0", titleColor: "#475569", detailColor: "#1f2937",
    iconBg: "#64748b", iconSvg: SVG_INFO, title: "GATEWAY UNAVAILABLE", sent: "Message sent without gateway verification."
  },
  unconfigured: {
    bg: "#f8fafc", border: "#e2e8f0", titleColor: "#475569", detailColor: "#1f2937",
    iconBg: "#64748b", iconSvg: SVG_INFO, title: "GATEWAY NOT CONFIGURED", sent: "Message sent without gateway verification."
  },
  purpose: {
    bg: "#eff6ff", border: "#bfdbfe", titleColor: "#1d4ed8", detailColor: "#1f2937",
    iconBg: "#2563eb", iconSvg: SVG_QUESTION, title: "PURPOSE REQUIRED", sent: "Nothing has been sent."
  },
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
  if (!document.getElementById("aigg-spin-style")) {
    const styleEl = document.createElement("style");
    styleEl.id = "aigg-spin-style";
    styleEl.textContent = `@keyframes aigg-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
    document.head.appendChild(styleEl);
  }
  const palette = STYLE[kind];
  const card = document.createElement("div");
  card.id = BANNER_ID;
  const timeString = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  Object.assign(card.style, {
    position: "fixed",
    right: "24px",
    bottom: "24px",
    zIndex: "2147483647",
    padding: "16px 18px",
    margin: "0",
    borderRadius: "14px",
    minWidth: "320px",
    maxWidth: "480px",
    fontSize: "13px",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    lineHeight: "1.4",
    background: palette.bg,
    color: palette.detailColor,
    border: `1px solid ${palette.border}`,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.08)",
    boxSizing: "border-box",
  });

  // Top header layout: Icon + Text Block
  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    paddingRight: "24px",
  });

  const iconCircle = document.createElement("div");
  iconCircle.innerHTML = palette.iconSvg;
  Object.assign(iconCircle.style, {
    width: "36px",
    height: "36px",
    minWidth: "36px",
    borderRadius: "50%",
    background: palette.iconBg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.12)",
  });

  const textGroup = document.createElement("div");
  Object.assign(textGroup.style, {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  });

  const title = document.createElement("div");
  title.textContent = palette.title;
  Object.assign(title.style, {
    fontWeight: "700",
    fontSize: "15px",
    letterSpacing: "0.01em",
    color: palette.titleColor,
  });

  const detail = document.createElement("div");
  detail.textContent = text;
  Object.assign(detail.style, {
    fontSize: "13.5px",
    color: palette.detailColor,
    fontWeight: "400",
    lineHeight: "1.35",
  });

  textGroup.append(title, detail);
  header.append(iconCircle, textGroup);

  // Close button
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss governance status");
  close.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  Object.assign(close.style, {
    position: "absolute",
    right: "12px",
    top: "12px",
    border: "0",
    background: "transparent",
    color: "#64748b",
    cursor: "pointer",
    padding: "4px",
    borderRadius: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });
  close.addEventListener("click", removeBanner);

  // Divider line
  const divider = document.createElement("div");
  Object.assign(divider.style, {
    marginTop: "14px",
    marginBottom: "10px",
    borderTop: `1px solid ${palette.border}`,
    opacity: "0.8",
  });

  // Footer layout: Status message + Timestamp
  const footer = document.createElement("div");
  Object.assign(footer.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: "13px",
  });

  const outcome = document.createElement("div");
  outcome.textContent = palette.sent;
  Object.assign(outcome.style, {
    fontWeight: "600",
    color: palette.detailColor,
  });

  const timestamp = document.createElement("div");
  timestamp.textContent = timeString;
  Object.assign(timestamp.style, {
    fontSize: "12px",
    fontWeight: "500",
    color: "#64748b",
    marginLeft: "12px",
    whiteSpace: "nowrap",
  });

  footer.append(outcome, timestamp);
  card.append(header, close, divider, footer);
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
export interface PurposePickerResult {
  category: string;       // PURPOSE_OPTIONS value, e.g. "data_analysis" -- sent as "purpose"
  justification: string;  // the free-text explanation the employee typed
}

export function showPurposePicker(_anchor: Element): Promise<PurposePickerResult | null> {
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
    // Gemini's dark theme applies color-scheme to native controls. Scope a
    // light control reset to our overlay only; never alter the host page.
    const reset = document.createElement("style");
    reset.textContent = `
      #${BANNER_ID}, #${BANNER_ID} * { color-scheme: light !important; }
      #${BANNER_ID} textarea, #${BANNER_ID} select {
        background: #ffffff !important; color: #17223b !important;
        -webkit-text-fill-color: #17223b !important;
      }
      #${BANNER_ID} textarea::placeholder { color: #64748b !important; opacity: 1 !important; }
      #${BANNER_ID} input[type="checkbox"] {
        appearance: auto !important; -webkit-appearance: checkbox !important;
        accent-color: #155eef !important; background: #ffffff !important;
        filter: none !important;
      }
    `;
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
      resolve({ category: category.value, justification: explanation.value.trim() });
    });
    panel.append(reset, title, intro, purposeLabel, explanation, categoryLabel, category, notice, checkArea, error, actions);
    actions.append(cancel, confirm); overlay.appendChild(panel); document.body.appendChild(overlay); explanation.focus();
  });
}
