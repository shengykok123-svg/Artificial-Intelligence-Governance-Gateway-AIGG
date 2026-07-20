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
  targetId?: string;
}

function isSetComposerRequest(data: unknown): data is SetComposerRequest {
  return (
    !!data &&
    typeof data === "object" &&
    (data as Record<string, unknown>).__aigg === "SET_COMPOSER"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Same React/ProseMirror-controlled-input workaround as before -- the
 * difference that matters here is WHERE this runs, not how it writes. */
async function writeComposer(el: HTMLElement, text: string): Promise<boolean> {
  el.focus();

  if (el.isContentEditable) {
    // Select-all via the native Selection/Range API alone does NOT reliably
    // reach ProseMirror's own selection/document model -- ProseMirror
    // tracks that separately, synced through its own beforeinput/input
    // handling, not through window.getSelection() changes made from
    // outside its event pipeline. Confirmed live: a paste dispatched right
    // after only a Range-based "select all" landed at ProseMirror's OLD
    // cursor position (end of the existing text), appending the correctly
    // redacted content after the original instead of replacing it.
    // execCommand("delete") IS a real editing command that flows through
    // the page's normal beforeinput/input path, so ProseMirror actually
    // updates its model to empty before the paste that follows.
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand("delete", false);
    // Empirically needed: the delete's resulting state update is not
    // guaranteed to be reflected synchronously (React/ProseMirror can batch
    // it), and a paste dispatched too soon after risks the same
    // stale-cursor problem this delay exists to avoid.
    await sleep(200);

    // Multi-line text needs an actual "paste", not execCommand("insertText"):
    // ProseMirror-based composers (ChatGPT, Gemini) intercept native paste
    // events and split clipboard text into paragraphs themselves.
    // execCommand("insertText") with embedded \n characters does not
    // round-trip through that same paragraph model -- confirmed live, a
    // single \n\n paragraph break became \n\n\n\n\n after one write, so the
    // composer's text can never converge on the expected string and
    // composerSettledOn() times out even though something WAS written.
    // Dispatching a real "paste" event lets the page's own handler do the
    // exact same paragraph split a genuine user paste would.
    //
    // No execCommand fallback here, on purpose: ChatGPT's own paste handler
    // processes the event without ever calling preventDefault(), so
    // dispatchEvent()'s return value cannot tell us whether the paste was
    // handled. Confirmed live: falling back "when not prevented" fired
    // execCommand("insertText") on top of a paste that had already been
    // applied, doubling the composer's content. If a future target site's
    // composer genuinely doesn't intercept paste, composerSettledOn() will
    // correctly report a mismatch rather than this function silently
    // guessing and duplicating text.
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
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

// Same re-injection hazard as content.ts (see its guard for the full
// explanation) -- this is a MAIN-world script, so it shares the page's own
// `window` across re-injections just as directly. Without this guard, a
// re-injected second instance would independently call writeComposer() for
// the SAME "SET_COMPOSER" request, doubling up execCommand/selection calls
// on one element and answering with two SET_COMPOSER_DONE replies.
if (!window.__aiggMainWorldActive) {
  window.__aiggMainWorldActive = true;

  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window || !isSetComposerRequest(e.data)) return;
    const { text, nonce, targetId } = e.data;

    void (async () => {
      // Re-resolve here, in this world, via the SAME candidate list
      // content.ts uses -- a DOM element reference cannot cross
      // postMessage's structured clone, and hardcoding a selector here
      // would be exactly the duplicated knowledge selectors.ts exists to
      // prevent.
      const site = siteKeyFor(location.hostname);
      const scoped = targetId ? document.querySelector(`[data-aigg-write-target="${CSS.escape(targetId)}"]`) : null;
      const el = (scoped as HTMLElement | null) ?? (site ? findComposer(site) : null);
      const ok = el ? await writeComposer(el, text) : false;

      window.postMessage({ __aigg: "SET_COMPOSER_DONE", nonce, ok }, "*");
    })();
  });
}

declare global {
  interface Window {
    __aiggMainWorldActive?: boolean;
  }
}
