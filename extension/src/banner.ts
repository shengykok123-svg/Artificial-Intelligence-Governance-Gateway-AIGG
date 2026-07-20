// M4  Inline banners: redact (names data classes), hold (waiting for approval), deny (shows reason).

import { PURPOSE_OPTIONS } from "./types";

const BANNER_ID = "aigg-banner";

export type BannerKind =
  | "redact"
  | "hold"
  | "deny"
  | "denied"
  | "timeout"
  | "unconfigured"
  | "unsupported_file"
  | "purpose";

const STYLE: Record<BannerKind, { bg: string; fg: string }> = {
  redact: { bg: "#fef3c7", fg: "#92400e" },
  hold: { bg: "#fef9c3", fg: "#854d0e" },
  deny: { bg: "#fee2e2", fg: "#991b1b" },
  denied: { bg: "#fee2e2", fg: "#991b1b" },
  timeout: { bg: "#e5e7eb", fg: "#374151" },
  unconfigured: { bg: "#e5e7eb", fg: "#374151" },
  unsupported_file: { bg: "#fee2e2", fg: "#991b1b" },
  purpose: { bg: "#dbeafe", fg: "#1e3a8a" },
};

/** Insert (replacing any existing) banner immediately before `anchor`. */
export function showBanner(anchor: Element, kind: BannerKind, text: string): void {
  removeBanner();
  const el = document.createElement("div");
  el.id = BANNER_ID;
  el.textContent = `AI Governance Gateway: ${text}`;
  const palette = STYLE[kind];
  Object.assign(el.style, {
    position: "relative",
    zIndex: "2147483647",
    padding: "8px 12px",
    margin: "6px 0",
    borderRadius: "8px",
    fontSize: "13px",
    fontFamily: "system-ui, sans-serif",
    lineHeight: "1.4",
    background: palette.bg,
    color: palette.fg,
    border: `1px solid ${palette.fg}`,
  });
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
