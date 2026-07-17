// M4  Every DOM selector lives HERE, in one exported SELECTORS object. data-testid and ARIA roles only, never hashed class names.
//
// Each site lists CANDIDATES, tried in order, first match wins. Multiple
// candidates -- not one "correct" selector -- because both sites obfuscate
// and reshuffle their DOM between deploys; a list degrades gracefully where
// a single string breaks outright. See README.md for what each candidate is
// anchored on and why.
//
// If nothing matches, every lookup below returns null and the caller does
// nothing and lets the prompt through (see content.ts) -- never throws.

export type SiteKey = "chatgpt" | "gemini";

export interface SiteSelectors {
  composer: string[];
  sendButton: string[];
  fileInput: string[];
}

export const SELECTORS: Record<SiteKey, SiteSelectors> = {
  chatgpt: {
    composer: [
      "#prompt-textarea",
      '[data-testid="prompt-textarea"]',
      'form [contenteditable="true"]',
    ],
    sendButton: [
      '[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
    ],
    fileInput: ['input[type="file"]'],
  },
  gemini: {
    composer: [
      'rich-textarea div[contenteditable="true"]',
      'div[aria-label="Enter a prompt here"]',
      '[role="textbox"][contenteditable="true"]',
    ],
    sendButton: [
      'button[aria-label="Send message"]',
      'button[aria-label="Submit"]',
      '[data-testid="send-button"]',
    ],
    fileInput: ['input[type="file"]'],
  },
};

export function siteKeyFor(hostname: string): SiteKey | null {
  if (hostname === "chatgpt.com") return "chatgpt";
  if (hostname === "gemini.google.com") return "gemini";
  return null;
}

function firstMatch(candidates: string[]): Element | null {
  for (const selector of candidates) {
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch {
      // an invalid selector should never crash the page -- skip it
    }
  }
  return null;
}

export function findComposer(site: SiteKey): HTMLElement | null {
  return firstMatch(SELECTORS[site].composer) as HTMLElement | null;
}

export function findSendButton(site: SiteKey): HTMLElement | null {
  return firstMatch(SELECTORS[site].sendButton) as HTMLElement | null;
}

export function findFileInput(site: SiteKey): HTMLInputElement | null {
  return firstMatch(SELECTORS[site].fileInput) as HTMLInputElement | null;
}
