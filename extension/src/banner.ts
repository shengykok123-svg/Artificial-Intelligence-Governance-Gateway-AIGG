// M4  Inline banners: redact (names data classes), hold (waiting for approval), deny (shows reason).

const BANNER_ID = "aigg-banner";

export type BannerKind =
  | "redact"
  | "hold"
  | "deny"
  | "denied"
  | "timeout"
  | "unconfigured"
  | "unsupported_file";

const STYLE: Record<BannerKind, { bg: string; fg: string }> = {
  redact: { bg: "#fef3c7", fg: "#92400e" },
  hold: { bg: "#fef9c3", fg: "#854d0e" },
  deny: { bg: "#fee2e2", fg: "#991b1b" },
  denied: { bg: "#fee2e2", fg: "#991b1b" },
  timeout: { bg: "#e5e7eb", fg: "#374151" },
  unconfigured: { bg: "#e5e7eb", fg: "#374151" },
  unsupported_file: { bg: "#fee2e2", fg: "#991b1b" },
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
