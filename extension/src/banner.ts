// M4  Inline banners: redact (names data classes), hold (waiting for approval), deny (shows reason).

import { PURPOSE_OPTIONS } from "./types";

const BANNER_ID = "aigg-banner";

export type BannerKind =
  | "allow"
  | "redact"
  | "hold"
  | "approved"
  | "deny"
  | "denied"
  | "timeout"
  | "gateway_unavailable"
  | "redaction_failed"
  | "unconfigured"
  | "unsupported_file"
  | "purpose";

type BannerStyle = { bg: string; fg: string; icon: string; title: string; sent: string };

const STYLE: Record<BannerKind, BannerStyle> = {
  allow: { bg: "#ecfdf5", fg: "#047857", icon: "✓", title: "ALLOW", sent: "Your message has been sent." },
  redact: { bg: "#fffbeb", fg: "#b45309", icon: "♢", title: "REDACT & SEND", sent: "Protected content was replaced before sending." },
  hold: { bg: "#fff7ed", fg: "#c2410c", icon: "⏸", title: "HOLD", sent: "Nothing has been sent." },
  approved: { bg: "#ecfdf5", fg: "#047857", icon: "✓", title: "APPROVED", sent: "Your message has been sent." },
  deny: { bg: "#fef2f2", fg: "#b91c1c", icon: "⊘", title: "DENY", sent: "Nothing has been sent." },
  denied: { bg: "#fef2f2", fg: "#b91c1c", icon: "⊘", title: "REVIEW DENIED", sent: "Nothing has been sent." },
  timeout: { bg: "#f8fafc", fg: "#475569", icon: "◷", title: "REVIEW PENDING", sent: "Nothing has been sent." },
  gateway_unavailable: { bg: "#f8fafc", fg: "#475569", icon: "!", title: "GATEWAY UNAVAILABLE", sent: "Message sent without gateway verification." },
  redaction_failed: { bg: "#fef2f2", fg: "#b91c1c", icon: "⊘", title: "REDACTION FAILED", sent: "Nothing has been sent." },
  unconfigured: { bg: "#f8fafc", fg: "#475569", icon: "!", title: "GATEWAY NOT CONFIGURED", sent: "Message sent without gateway verification." },
  unsupported_file: { bg: "#fef2f2", fg: "#b91c1c", icon: "⊘", title: "UNSUPPORTED ATTACHMENT", sent: "Nothing has been sent." },
  purpose: { bg: "#eff6ff", fg: "#1d4ed8", icon: "?", title: "PURPOSE REQUIRED", sent: "Nothing has been sent." },
};

/** Insert (replacing any existing) banner immediately before `anchor`. */
export function showBanner(anchor: Element, kind: BannerKind, text: string): void {
  removeBanner();
  const el = document.createElement("div");
  el.id = BANNER_ID;
  const palette = STYLE[kind];
  Object.assign(el.style, {
    position: "relative",
    zIndex: "2147483647",
    padding: "12px 14px",
    margin: "8px 0",
    borderRadius: "10px",
    minWidth: "280px",
    maxWidth: "560px",
    fontSize: "13px",
    fontFamily: "system-ui, sans-serif",
    lineHeight: "1.4",
    background: palette.bg,
    color: palette.fg,
    border: `1px solid ${palette.fg}55`,
    boxShadow: "0 4px 16px rgba(15, 23, 42, 0.10)",
  });

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Dismiss governance status");
  Object.assign(close.style, {
    position: "absolute", right: "8px", top: "5px", border: "0", background: "transparent",
    color: palette.fg, cursor: "pointer", fontSize: "20px", lineHeight: "1",
  });
  close.addEventListener("click", removeBanner);

  const heading = document.createElement("div");
  heading.textContent = `${palette.icon}  ${palette.title}`;
  Object.assign(heading.style, { fontWeight: "700", letterSpacing: "0.02em", paddingRight: "24px" });

  const detail = document.createElement("div");
  detail.textContent = text;
  Object.assign(detail.style, { marginTop: "3px", color: "#1f2937" });

  const outcome = document.createElement("div");
  outcome.textContent = palette.sent;
  Object.assign(outcome.style, { marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${palette.fg}33`, fontWeight: "600" });

  el.append(heading, detail, outcome, close);
  anchor.parentElement?.insertBefore(el, anchor);
}

export function removeBanner(): void {
  document.getElementById(BANNER_ID)?.remove();
}

/** True if `node` is inside our own banner/picker. content.ts's document-level
 * capture listeners use this to ignore events the picker generates -- e.g.
 * its free-text input matches the same `input[type="text"]` selector as a
 * real composer edit field, and would otherwise get misread as one. */
export function isInsideBanner(node: Node | null): boolean {
  const banner = document.getElementById(BANNER_ID);
  return !!banner && !!node && banner.contains(node);
}

/** "State & allow": ask which of the fixed purposes applies before
 * resubmitting. Never window.prompt -- that blocks all further extension
 * events, including the resubmit this banner exists to trigger. Resolves
 * with the chosen purpose once Continue is clicked; never rejects.
 *
 * Fixed-positioned and appended to <body> -- NOT inserted as a sibling of
 * the composer. Both ChatGPT and Gemini re-render that region on nearly
 * every keystroke/focus change; a node injected into it is invisible to
 * their virtual DOM and gets fought over on every re-render, which reads as
 * the picker flickering while you try to use it. */
export function showPurposePicker(anchor: Element): Promise<string> {
  return new Promise((resolve) => {
    removeBanner();
    const el = document.createElement("div");
    el.id = BANNER_ID;
    const palette = STYLE.purpose;
    const rect = anchor.getBoundingClientRect();
    Object.assign(el.style, {
      position: "fixed",
      left: `${Math.max(8, rect.left)}px`,
      top: `${rect.bottom + 6}px`,
      maxWidth: "min(480px, calc(100vw - 16px))",
      zIndex: "2147483647",
      padding: "10px 12px",
      borderRadius: "8px",
      fontSize: "13px",
      fontFamily: "system-ui, sans-serif",
      lineHeight: "1.4",
      background: palette.bg,
      color: palette.fg,
      border: `1px solid ${palette.fg}`,
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "8px",
    });

    const label = document.createElement("span");
    label.textContent = "AI Governance Gateway: state a purpose to continue.";
    el.appendChild(label);

    const select = document.createElement("select");
    select.style.fontSize = "13px";
    for (const opt of PURPOSE_OPTIONS) {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    }
    el.appendChild(select);

    const otherInput = document.createElement("input");
    otherInput.type = "text";
    otherInput.placeholder = "Describe the purpose";
    otherInput.style.fontSize = "13px";
    otherInput.style.display = "none";
    el.appendChild(otherInput);

    select.addEventListener("change", () => {
      otherInput.style.display = select.value === "other" ? "" : "none";
    });

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Continue";
    Object.assign(button.style, {
      border: `1px solid ${palette.fg}`,
      borderRadius: "6px",
      padding: "4px 10px",
      background: palette.fg,
      color: "#fff",
      cursor: "pointer",
      fontSize: "13px",
    });
    button.addEventListener("click", () => {
      const purpose =
        select.value === "other"
          ? otherInput.value.trim() || "other"
          : select.value;
      removeBanner();
      resolve(purpose);
    });
    el.appendChild(button);

    document.body.appendChild(el);
  });
}
