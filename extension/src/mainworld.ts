// M4  Runs in the MAIN world. content.ts is isolated: it shares the DOM but
// not the page's JS, so a DOM write there never reaches ProseMirror's internal
// model -- and that model, not the DOM, is what ChatGPT submits at send time.
// A write from the isolated world can leave the composer LOOKING redacted
// (content.ts reads the shared DOM back correctly) while the original still
// goes out, because the model that actually gets submitted never saw it.
//
// This is the only code allowed to write the composer, for that reason.
// It talks to content.ts over window.postMessage -- the standard bridge
// between an isolated-world content script and the page's own JS context,
// since both share the same `window` for message events even though
// nothing else about their JS is shared.

import { findComposer, siteKeyFor } from "./selectors";

interface SetComposerRequest {
  __aigg: "SET_COMPOSER";
  text: string;
  nonce: string;
}

function isSetComposerRequest(data: unknown): data is SetComposerRequest {
  return (
    !!data &&
    typeof data === "object" &&
    (data as Record<string, unknown>).__aigg === "SET_COMPOSER"
  );
}

/** Same React/ProseMirror-controlled-input workaround as before -- the
 * difference that matters here is WHERE this runs, not how it writes. */
function writeComposer(el: HTMLElement, text: string): boolean {
  el.focus();

  if (el.isContentEditable) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    return true;
  }

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto =
      el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  return false;
}

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window || !isSetComposerRequest(e.data)) return;
  const { text, nonce } = e.data;

  // Re-resolve here, in this world, via the SAME candidate list content.ts
  // uses -- a DOM element reference cannot cross postMessage's structured
  // clone, and hardcoding a selector here would be exactly the duplicated
  // knowledge selectors.ts exists to prevent.
  const site = siteKeyFor(location.hostname);
  const el = site ? findComposer(site) : null;
  const ok = el ? writeComposer(el, text) : false;

  window.postMessage({ __aigg: "SET_COMPOSER_DONE", nonce, ok }, "*");
});
