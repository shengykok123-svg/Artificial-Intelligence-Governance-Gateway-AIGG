// M4  Composer capture + send interception. Produces IF-1. Failed selector => do nothing, never freeze the composer.
//
// Delegated, capture-phase listeners on `document` re-resolve the composer
// and send button on every event rather than binding once to a specific
// node. Both target sites are SPAs that replace these nodes on re-render;
// a one-time bind goes stale, a fresh lookup does not. The same lookup
// returning null is also how "selector not found" degrades to "do nothing,
// let the prompt through" -- there is no separate error path to forget.

import { findComposer, findFileInput, findSendButton, siteKeyFor, type SiteKey } from "./selectors";
import { isInsideBanner, removeBanner, showBanner, showPurposePicker } from "./banner";
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
  // "State & allow": remembered for the life of this composer session so a
  // second message in the same conversation does not re-prompt.
  let sessionPurpose = "GENERAL";

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

  async function sendInspect(
    prompt: string, files: AttachmentPayload[], purpose: string,
  ): Promise<InspectOutcome> {
    return chrome.runtime.sendMessage<InspectMessage, InspectOutcome>({
      type: "INSPECT",
      prompt,
      files,
      targetHost: location.hostname,
      purpose,
    });
  }

  /** "State & allow": pass 1 with the remembered purpose. If the policy
   * requires an attested purpose we do not have yet, show the picker banner
   * and resubmit the IDENTICAL prompt+files once. A rule that still demands
   * a purpose after a real one was given is misconfigured -- never loop,
   * treat it as a deny instead. */
  async function inspectWithPurpose(
    prompt: string, files: AttachmentPayload[], anchor: HTMLElement | null,
  ): Promise<InspectOutcome> {
    const first = await sendInspect(prompt, files, sessionPurpose);
    if (!first.ok || !first.result.require_purpose) return first;

    if (sessionPurpose !== "GENERAL" || !anchor) {
      return {
        ok: true,
        result: {
          ...first.result,
          decision: "deny",
          reason: `Policy requires a purpose that was not honoured: ${first.result.reason}`,
        },
      };
    }

    const chosen = await showPurposePicker(anchor);
    if (chosen === null) {
      return {
        ok: true,
        result: {
          ...first.result,
          decision: "deny",
          require_purpose: false,
          reason: "Justification was cancelled. Nothing was sent.",
        },
      };
    }
    sessionPurpose = chosen;

    const second = await sendInspect(prompt, files, chosen);
    if (second.ok && second.result.require_purpose) {
      return {
        ok: true,
        result: {
          ...second.result,
          decision: "deny",
          reason: `Policy requires a purpose that was not honoured: ${second.result.reason}`,
        },
      };
    }
    return second;
  }

  async function preprocessFilesBeforeUpload(input: HTMLInputElement, files: File[]): Promise<void> {
    const composer = findComposer(site);
    const encoded = await encodeFiles(files);

    if (composer) showBanner(composer, "hold", "Checking the attachment before it is added.");

    let outcome: InspectOutcome;
    try {
      outcome = await inspectWithPurpose("", encoded, composer);
    } catch (err) {
      console.warn("[aigg] pre-upload inspection failed:", err);
      if (composer) showBanner(composer, "gateway_unavailable", "The attachment could not be checked, so it was not added.");
      return;
    }

    if (!outcome.ok) {
      if (composer) showBanner(composer, "unsupported_file", `The attachment could not be checked. ${outcome.message}`);
      return;
    }

    // Same staleness concern as attemptSend: the purpose picker can wait on
    // a human for a while, and attaching a file is exactly the kind of
    // action that gets these SPAs to replace the file input / composer
    // chrome. Re-resolve both fresh before touching the DOM.
    const liveInput = findFileInput(site) ?? input;
    const liveComposer = findComposer(site);

    const result = outcome.result;
    switch (result.decision) {
      case "allow":
        injectFiles(liveInput, files);
        capturedAttachments = encoded;
        if (liveComposer) {
          showBanner(liveComposer, "allow", "Attachment checked and added.");
          removeBannerSoon("Attachment checked and added");
        }
        return;

      case "redact": {
        if (result.redacted_attachments.length !== files.length) {
          if (liveComposer) showBanner(liveComposer, "redaction_failed", "The protected attachment could not be prepared safely.");
          return;
        }

        const redactedFiles = result.redacted_attachments.map(payloadToFile);
        injectFiles(liveInput, redactedFiles);
        capturedAttachments = result.redacted_attachments;
        if (liveComposer) {
          showBanner(
            liveComposer,
            "redact",
            `redacted attachment before upload (${result.data_classes.join(", ") || "sensitive data"}).`,
          );
          removeBannerSoon("redacted attachment before upload");
        }
        return;
      }

      case "hold":
        if (liveComposer) showBanner(liveComposer, "hold", "The attachment is pending compliance review and has not been added.");
        capturedAttachments = [];
        return;

      case "deny":
        if (liveComposer) showBanner(liveComposer, "deny", result.reason);
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
    if (isInsideBanner(target)) return; // the picker's own Continue/select, not a page control
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
    if (isInsideBanner(target)) return; // the picker's own free-text field, not a composer edit
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

    let outcome: InspectOutcome;
    try {
      outcome = await inspectWithPurpose(prompt, files, composer);
    } catch (err) {
      // Messaging layer itself failed (e.g. service worker briefly gone).
      // Same policy as an unreachable backend: fail OPEN.
      console.warn("[aigg] sendMessage failed, failing open:", err);
      showBanner(composer, "gateway_unavailable", "The local gateway could not be reached, so this message was not inspected.");
      replaySend(composer, replay);
      removeBannerSoon("local gateway could not be reached");
      return;
    }

    if (!outcome.ok) {
      showDebugFailure(outcome.message);
      handleFailure(composer, outcome, replay);
      return;
    }

    const result = outcome.result;
    showInspectDebug(result);

    // inspectWithPurpose can now include an arbitrarily long HUMAN wait (the
    // purpose picker), not just a network round-trip. Both target sites are
    // SPAs that routinely replace the composer node during that wait (e.g.
    // attaching a file re-renders the composer chrome) -- the `composer`
    // reference captured before the picker opened can be stale by the time
    // we get here. Re-resolve it fresh rather than writing to / reading back
    // from a detached node, which would fail the settle-check below even
    // when mainworld.ts's own write succeeded on the live element.
    const liveComposer = findComposer(site) ?? composer;

    switch (result.decision) {
      case "allow":
        showBanner(liveComposer, "allow", "No material risk was detected.");
        replaySend(liveComposer, replay);
        removeBannerSoon("No material risk was detected");
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

        const wrote = await setComposerViaMainWorld(redacted, liveComposer);
        const settled = wrote && (await composerSettledOn(liveComposer, redacted));
        if (!settled) {
          showBanner(liveComposer, "redaction_failed",
            "The protected replacement could not be applied safely.");
          return; // FAIL CLOSED. Never ship the original.
        }

        showBanner(
          liveComposer,
          "redact",
          `redacted before sending (${result.data_classes.join(", ") || "sensitive data"}).`,
        );
        replaySend(liveComposer, replay);
        removeBannerSoon("redacted before sending");
        return;
      }

      case "hold":
        activeLogId = result.log_id;
        activeHoldSnapshot = { logId: result.log_id, prompt, replayMode: replay.kind };
        showBanner(liveComposer, "hold", "Pending compliance review. A reviewer must approve it before it can be sent.");
        startHoldPolling(result.log_id);
        return;

      case "deny":
        showBanner(liveComposer, "deny", result.reason);
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
        showBanner(composer, "gateway_unavailable", "The local gateway could not be reached, so this message was not inspected.");
        replaySend(composer, replay);
        removeBannerSoon("local gateway could not be reached");
        return;

      case "unconfigured":
        showBanner(composer, "unconfigured", "This extension has no gateway profile for the current user.");
        replaySend(composer, replay);
        removeBannerSoon("no gateway profile");
        return;

      case "unsupported_file":
        // Fail CLOSED: we cannot vouch for a file we never inspected.
        showBanner(composer, "unsupported_file", `This file could not be inspected. ${outcome.message}`);
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
        showBanner(bannerTarget, "approved", "The edited request was approved. Submit it again so the latest content can be checked and sent.");
        return;
      }
      if (composer) {
        if (!holdSnapshot || getComposerText(composer).trim() !== holdSnapshot.prompt) {
          showBanner(composer, "hold", "The reviewed content changed before approval was received. Submit again to re-check it.");
          return;
        }

        // Lazy hold-timeout downgrade: the server prepared a redaction and
        // wants it applied before sending. A genuine human-reviewed approval
        // carries no redacted_prompt and replays the ORIGINAL, unchanged.
        const redactedPrompt = message.redacted_prompt;
        if (redactedPrompt != null && redactedPrompt !== holdSnapshot.prompt) {
          void (async () => {
            const wrote = await setComposerViaMainWorld(redactedPrompt, composer);
            const settled = wrote && (await composerSettledOn(composer, redactedPrompt));
            if (!settled) {
              showBanner(composer, "redaction_failed",
                "The review timed out, but its prepared redaction could not be applied safely.");
              return;
            }
            showBanner(composer, "redact", "Review timed out. The prepared protected version is being sent instead.");
            replaySend(composer, { kind: "composer", target: null });
            removeBannerSoon("sending the prepared redaction now.");
          })();
          return;
        }

        showBanner(composer, "approved", "Compliance review approved this request.");
        replaySend(composer, { kind: "composer", target: null }); // replays the ORIGINAL prompt: hold never touched composer contents
        removeBannerSoon("approved -- sending now.");
      }
    } else if (message.status === "denied") {
      if (composer) showBanner(composer, "denied", "A compliance reviewer did not approve this request.");
    } else {
      if (composer) showBanner(composer, "timeout", "This review is still pending. Try again shortly or ask a reviewer to resolve it.");
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
          onBackgroundMessage({
            type: "HOLD_RESOLVED", log_id: logId, status: status.status,
            redacted_prompt: status.redacted_prompt,
          });
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
