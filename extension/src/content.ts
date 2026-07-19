// M4  Composer capture + send interception. Produces IF-1. Failed selector => do nothing, never freeze the composer.
//
// Delegated, capture-phase listeners on `document` re-resolve the composer
// and send button on every event rather than binding once to a specific
// node. Both target sites are SPAs that replace these nodes on re-render;
// a one-time bind goes stale, a fresh lookup does not. The same lookup
// returning null is also how "selector not found" degrades to "do nothing,
// let the prompt through" -- there is no separate error path to forget.

import { findComposer, findFileInput, findSendButton, siteKeyFor, type SiteKey } from "./selectors";
import { removeBanner, showBanner } from "./banner";
import { showDebugFailure, showInspectDebug } from "./debug-panel";
import type {
  AttachmentPayload,
  BackgroundMessage,
  InspectMessage,
  InspectOutcome,
  InspectStatusResponse,
} from "./types";

interface ReplayContext {
  kind: "composer" | "edit";
  target: HTMLElement | null;
}

const site = siteKeyFor(location.hostname);
if (site) init(site);

function init(site: SiteKey): void {
  let isReplaying = false;
  let isInjectingFiles = false;
  let capturedAttachments: AttachmentPayload[] = [];
  let activeLogId: string | null = null;
  let activeHoldSnapshot: { logId: string; prompt: string; replayMode: "composer" | "edit" } | null = null;
  let holdPollTimer: number | null = null;

  window.addEventListener("change", onFileInputChange, true);
  document.addEventListener("input", onComposerMutation, true);
  document.addEventListener("beforeinput", onComposerMutation, true);
  document.addEventListener("paste", onComposerMutation, true);
  document.addEventListener("cut", onComposerMutation, true);
  document.addEventListener("drop", onComposerMutation, true);
  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("keydown", onKeydownCapture, true);
  chrome.runtime.onMessage.addListener(onBackgroundMessage);

  function onFileInputChange(e: Event): void {
    const input = findFileInput(site);
    if (!input || e.target !== input) return;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;

    invalidateActiveHold("attachment changed after review request -- click Send again to re-check.");

    if (isInjectingFiles) {
      void encodeFiles(files).then((encoded) => {
        capturedAttachments = encoded;
      });
      return;
    }

    if (!files.every(canPreprocessFile)) {
      void encodeFiles(files).then((encoded) => {
        capturedAttachments = encoded;
      });
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    input.value = "";

    void preprocessFilesBeforeUpload(input, files);
  }

  function onComposerMutation(e: Event): void {
    if (!activeHoldSnapshot || isReplaying) return;
    const composer = findComposer(site);
    const target = e.target as Node | null;
    if (!composer || !target || !composer.contains(target)) return;

    window.setTimeout(() => {
      if (!activeHoldSnapshot) return;
      const latest = getComposerText(composer).trim();
      if (latest !== activeHoldSnapshot.prompt) {
        invalidateActiveHold("prompt changed after review request -- click Send again to re-check.");
      }
    }, 0);
  }

  async function preprocessFilesBeforeUpload(input: HTMLInputElement, files: File[]): Promise<void> {
    const composer = findComposer(site);
    const encoded = await encodeFiles(files);

    if (composer) showBanner(composer, "hold", "checking attachment before upload.");

    let outcome: InspectOutcome;
    try {
      outcome = await chrome.runtime.sendMessage<InspectMessage, InspectOutcome>({
        type: "INSPECT",
        prompt: "",
        files: encoded,
        targetHost: location.hostname,
      });
    } catch (err) {
      console.warn("[aigg] pre-upload inspection failed:", err);
      if (composer) showBanner(composer, "deny", "attachment could not be checked -- not attached.");
      return;
    }

    if (!outcome.ok) {
      if (composer) showBanner(composer, "deny", `attachment could not be checked -- not attached. ${outcome.message}`);
      return;
    }

    const result = outcome.result;
    switch (result.decision) {
      case "allow":
        injectFiles(input, files);
        capturedAttachments = encoded;
        removeBanner();
        return;

      case "redact": {
        if (result.redacted_attachments.length !== files.length) {
          if (composer) showBanner(composer, "deny", "redacted attachment was not available. Nothing was attached.");
          return;
        }

        const redactedFiles = result.redacted_attachments.map(payloadToFile);
        injectFiles(input, redactedFiles);
        capturedAttachments = result.redacted_attachments;
        if (composer) {
          showBanner(
            composer,
            "redact",
            `redacted attachment before upload (${result.data_classes.join(", ") || "sensitive data"}).`,
          );
          removeBannerSoon("redacted attachment before upload");
        }
        return;
      }

      case "hold":
        if (composer) showBanner(composer, "hold", "attachment held for compliance review -- not attached yet.");
        capturedAttachments = [];
        return;

      case "deny":
        if (composer) showBanner(composer, "deny", `blocked attachment: ${result.reason}`);
        capturedAttachments = [];
        return;
    }
  }

  function injectFiles(input: HTMLInputElement, files: File[]): void {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    isInjectingFiles = true;
    try {
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } finally {
      isInjectingFiles = false;
    }
  }

  function canPreprocessFile(file: File): boolean {
    const type = file.type.toLowerCase().split(";")[0].trim();
    const name = file.name.toLowerCase();
    return (
      type === "text/plain" ||
      type === "text/csv" ||
      type === "image/png" ||
      type === "image/jpeg" ||
      type === "application/pdf" ||
      type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      name.endsWith(".txt") ||
      name.endsWith(".csv") ||
      name.endsWith(".png") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".pdf") ||
      name.endsWith(".docx") ||
      name.endsWith(".pptx") ||
      name.endsWith(".xlsx")
    );
  }

  function payloadToFile(payload: AttachmentPayload): File {
    return new File([base64ToArrayBuffer(payload.content_b64)], payload.filename, { type: payload.mime });
  }

  function base64ToArrayBuffer(content: string): ArrayBuffer {
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function onClickCapture(e: MouseEvent): void {
    if (isReplaying) return;
    const target = e.target as Element | null;
    if (!target) return;
    scheduleAttachmentRefreshIfRemoval(target);

    const sendBtn = findSendButton(site);
    if (sendBtn && (target === sendBtn || sendBtn.contains(target))) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      void attemptSend(findComposer(site), { kind: "composer", target: sendBtn });
      return;
    }

    const editSubmit = findEditableSubmitButton(target);
    const editComposer = editSubmit ? findEditableNear(editSubmit) : null;
    if (!editSubmit || !editComposer) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    void attemptSend(editComposer, { kind: "edit", target: editSubmit });
  }

  function onKeydownCapture(e: KeyboardEvent): void {
    if (isReplaying) return;
    if (e.key !== "Enter" || e.shiftKey) return;
    const target = e.target as Node | null;
    const composer = findComposer(site);
    const editable = findEditableTarget(target);
    if (!editable) return;
    const activeComposer: HTMLElement = composer?.contains(target) ? composer : editable;
    const isMainComposer = activeComposer === composer;
    const replayContext: ReplayContext = {
      kind: isMainComposer ? "composer" : "edit",
      target: isMainComposer ? null : findEditableSubmitNear(activeComposer),
    };
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    void attemptSend(activeComposer, replayContext);
  }

  function findEditableSubmitButton(target: Element): HTMLElement | null {
    const button = target.closest("button");
    if (!(button instanceof HTMLElement)) return null;
    if (button === findSendButton(site)) return null;
    if (!buttonLooksLikeSubmit(button)) return null;
    return findEditableNear(button) ? button : null;
  }

  function buttonLooksLikeSubmit(button: HTMLElement): boolean {
    const label = [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.textContent,
    ].join(" ").toLowerCase();
    if (/\b(send|submit|save|update|confirm)\b/.test(label)) return true;
    return button instanceof HTMLButtonElement && button.type === "submit";
  }

  function findEditableNear(button: HTMLElement): HTMLElement | null {
    let node: HTMLElement | null = button;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const editable = Array.from(
        node.querySelectorAll<HTMLElement>(
          'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]',
        ),
      )
        .filter((el) => isVisible(el))
        .sort((a, b) => getComposerText(b).trim().length - getComposerText(a).trim().length)[0];
      if (editable) return editable;
    }
    return null;
  }

  async function attemptSend(composer: HTMLElement | null, replay: ReplayContext): Promise<void> {
    if (!composer) return; // no composer found -- let whatever happens, happen

    refreshCapturedAttachments(composer);
    const prompt = getComposerText(composer).trim();
    if (!prompt && capturedAttachments.length === 0) return;

    const files = capturedAttachments;
    capturedAttachments = [];

    const message: InspectMessage = { type: "INSPECT", prompt, files, targetHost: location.hostname };

    let outcome: InspectOutcome;
    try {
      outcome = await chrome.runtime.sendMessage<InspectMessage, InspectOutcome>(message);
    } catch (err) {
      // Messaging layer itself failed (e.g. service worker briefly gone).
      // Same policy as an unreachable backend: fail OPEN.
      console.warn("[aigg] sendMessage failed, failing open:", err);
      replaySend(composer, replay);
      return;
    }

    if (!outcome.ok) {
      showDebugFailure(outcome.message);
      handleFailure(composer, outcome, replay);
      return;
    }

    const result = outcome.result;
    showInspectDebug(result);
    switch (result.decision) {
      case "allow":
        replaySend(composer, replay);
        return;

      case "redact": {
        // The write itself must happen in the MAIN world (mainworld.ts), not
        // here. This content script is isolated: it shares the DOM with the
        // page but not the page's JS, so a DOM write from here is invisible
        // to ProseMirror's internal document model -- and that model, not
        // the DOM, is what actually gets submitted. A write from here can
        // leave the composer LOOKING redacted while the original still ships.
        // Verify the result reads back stable before ever replaying.
        const redacted = result.redacted_prompt ?? prompt;
        removeBanner();

        const wrote = await setComposerViaMainWorld(redacted, composer);
        const settled = wrote && (await composerSettledOn(composer, redacted));
        if (!settled) {
          showBanner(composer, "deny",
            "Redaction could not be applied in place. Nothing was sent.");
          return; // FAIL CLOSED. Never ship the original.
        }

        showBanner(
          composer,
          "redact",
          `redacted before sending (${result.data_classes.join(", ") || "sensitive data"}).`,
        );
        replaySend(composer, replay);
        removeBannerSoon("redacted before sending");
        return;
      }

      case "hold":
        activeLogId = result.log_id;
        activeHoldSnapshot = { logId: result.log_id, prompt, replayMode: replay.kind };
        showBanner(composer, "hold", "held for compliance review -- waiting for approval.");
        startHoldPolling(result.log_id);
        return;

      case "deny":
        showBanner(composer, "deny", `blocked: ${result.reason}`);
        return;
    }
  }

  function handleFailure(
    composer: HTMLElement,
    outcome: Extract<InspectOutcome, { ok: false }>,
    replay: ReplayContext,
  ): void {
    switch (outcome.reason) {
      case "unreachable":
        // Fail OPEN. A gateway that bricks the composer when the backend
        // blinks does not survive a demo, and blocking here would make the
        // tool itself the bypass. Known limitation -- see extension/README.md.
        replaySend(composer, replay);
        return;

      case "unconfigured":
        showBanner(composer, "unconfigured", "extension not configured (unknown user) -- letting this through.");
        replaySend(composer, replay);
        return;

      case "unsupported_file":
        // Fail CLOSED: we cannot vouch for a file we never inspected.
        showBanner(composer, "unsupported_file", `attachment could not be read -- blocked. ${outcome.message}`);
        return;
    }
  }

  function onBackgroundMessage(message: BackgroundMessage): void {
    if (message.type !== "HOLD_RESOLVED" || message.log_id !== activeLogId) return;
    const holdSnapshot = activeHoldSnapshot;
    activeLogId = null;
    activeHoldSnapshot = null;
    stopHoldPolling();

    const composer = findComposer(site);
    if (message.status === "approved") {
      if (holdSnapshot?.replayMode === "edit") {
        const bannerTarget = composer ?? document.body;
        showBanner(bannerTarget, "hold", "approved edit request -- click submit again to re-check and send.");
        return;
      }
      if (composer) {
        if (!holdSnapshot || getComposerText(composer).trim() !== holdSnapshot.prompt) {
          showBanner(composer, "hold", "approved request changed -- not sent. Click Send again to re-check.");
          return;
        }
        showBanner(composer, "hold", "approved -- sending now.");
        replaySend(composer, { kind: "composer", target: null }); // replays the ORIGINAL prompt: hold never touched composer contents
        removeBannerSoon("approved -- sending now.");
      }
    } else if (message.status === "denied") {
      if (composer) showBanner(composer, "denied", "denied by reviewer. Not sent.");
    } else {
      if (composer) showBanner(composer, "timeout", "still pending after 5 minutes. Not sent -- try again shortly.");
    }
  }

  function startHoldPolling(logId: string): void {
    stopHoldPolling();
    holdPollTimer = window.setInterval(() => {
      if (activeLogId !== logId) {
        stopHoldPolling();
        return;
      }

      void chrome.runtime
        .sendMessage<{ type: "CHECK_HOLD_STATUS"; log_id: string }, InspectStatusResponse>({
          type: "CHECK_HOLD_STATUS",
          log_id: logId,
        })
        .then((status) => {
          if (status.status === "pending") return;
          onBackgroundMessage({ type: "HOLD_RESOLVED", log_id: logId, status: status.status });
        })
        .catch((err) => {
          console.warn("[aigg] hold status message failed:", err);
        });
    }, 3_000);
  }

  function stopHoldPolling(): void {
    if (holdPollTimer === null) return;
    window.clearInterval(holdPollTimer);
    holdPollTimer = null;
  }

  function invalidateActiveHold(message: string): void {
    if (!activeHoldSnapshot) return;
    activeLogId = null;
    activeHoldSnapshot = null;
    stopHoldPolling();

    const composer = findComposer(site);
    if (composer) showBanner(composer, "hold", message);
  }

  function scheduleAttachmentRefreshIfRemoval(target: Element): void {
    if (capturedAttachments.length === 0) return;
    const action = target.closest<HTMLElement>('button, [role="button"], [aria-label], [title]');
    if (!action) return;
    const label = [action.getAttribute("aria-label"), action.getAttribute("title"), action.textContent]
      .join(" ")
      .toLowerCase();
    if (!/\b(remove|delete|close|discard|clear|cancel)\b/.test(label)) return;

    window.setTimeout(() => {
      const composer = findComposer(site);
      if (composer) refreshCapturedAttachments(composer);
    }, 150);
  }

  function refreshCapturedAttachments(composer: HTMLElement): void {
    if (capturedAttachments.length === 0) return;

    const scope = findComposerShell(composer);
    const visibleText = (scope?.innerText || document.body.innerText || "").toLowerCase();
    const stillVisible = capturedAttachments.filter((attachment) =>
      visibleText.includes(attachment.filename.toLowerCase()),
    );

    if (stillVisible.length === capturedAttachments.length) return;
    capturedAttachments = stillVisible;
  }

  function removeBannerSoon(expectedText: string): void {
    window.setTimeout(() => {
      const banner = document.getElementById("aigg-banner");
      if (banner?.textContent?.includes(expectedText)) removeBanner();
    }, 3_000);
  }

  function replaySend(composer: HTMLElement, replay: ReplayContext): void {
    isReplaying = true;
    try {
      const liveTarget =
        replay.target && replay.target.isConnected
          ? replay.target
          : replay.kind === "edit"
            ? findEditableSubmitNear(composer)
            : null;
      if (liveTarget) {
        liveTarget.click();
        return;
      }
      if (replay.kind === "edit") {
        composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        return;
      }
      const btn = findSendButton(site);
      if (btn) {
        btn.click();
        return;
      }
      // Fallback only: React handlers frequently ignore synthetic
      // KeyboardEvents, so a real button click above is always preferred.
      composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    } finally {
      isReplaying = false;
    }
  }

  function findEditableSubmitNear(composer: HTMLElement): HTMLElement | null {
    let node: HTMLElement | null = composer;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const button = Array.from(node.querySelectorAll<HTMLElement>("button"))
        .filter((candidate) => candidate.isConnected && isVisible(candidate) && buttonLooksLikeSubmit(candidate))[0];
      if (button) return button;
    }
    return null;
  }

  function findComposerShell(composer: HTMLElement): HTMLElement | null {
    let node: HTMLElement | null = composer;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      const text = node.innerText.toLowerCase();
      if (capturedAttachments.some((attachment) => text.includes(attachment.filename.toLowerCase()))) {
        return node;
      }
    }
    return null;
  }
}

async function encodeFiles(files: File[]): Promise<AttachmentPayload[]> {
  return Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      mime: file.type || "application/octet-stream",
      content_b64: await fileToBase64(file),
    })),
  );
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function getComposerText(el: HTMLElement): string {
  if (el.isContentEditable) return el.innerText;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return el.textContent ?? "";
}

function findEditableTarget(target: Node | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const editable = target.closest<HTMLElement>(
    'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]',
  );
  if (!editable || !isVisible(editable)) return null;
  return editable;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

/** True once the composer reads `expected` AND KEEPS reading it. A single read
 *  is not enough: if ProseMirror's internal model still holds the original, it
 *  re-renders the DOM back and the check must catch that revert. */
async function composerSettledOn(el: HTMLElement, expected: string): Promise<boolean> {
  const want = expected.trim();
  const deadline = Date.now() + 1500;
  let stableSince = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 30));
    if (getComposerText(el).trim() === want) {
      if (stableSince === 0) stableSince = Date.now();
      if (Date.now() - stableSince >= 120) return true;
    } else {
      stableSince = 0; // reverted -- internal state won
    }
  }
  return false;
}

/** Ask mainworld.ts (running in the page's own JS context) to write the
 * composer, and wait for its reply. window.postMessage is the standard
 * bridge here: an isolated-world content script and the page's main-world
 * JS share nothing except the DOM and this one `window` messaging channel.
 * Resolves false if mainworld.ts never answers (e.g. it failed to find the
 * composer either) rather than hanging -- the caller must fail closed. */
function setComposerViaMainWorld(text: string, target?: HTMLElement): Promise<boolean> {
  return new Promise((resolve) => {
    const nonce = Math.random().toString(36).slice(2);
    target?.setAttribute("data-aigg-write-target", nonce);
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onResponse);
      target?.removeAttribute("data-aigg-write-target");
      resolve(false);
    }, 1500);

    function onResponse(e: MessageEvent): void {
      if (e.source !== window) return;
      const data = e.data as { __aigg?: string; nonce?: string; ok?: boolean } | undefined;
      if (data?.__aigg !== "SET_COMPOSER_DONE" || data.nonce !== nonce) return;
      clearTimeout(timeout);
      window.removeEventListener("message", onResponse);
      target?.removeAttribute("data-aigg-write-target");
      resolve(Boolean(data.ok));
    }

    window.addEventListener("message", onResponse);
    window.postMessage({ __aigg: "SET_COMPOSER", text, nonce, targetId: target ? nonce : undefined }, "*");
  });
}
