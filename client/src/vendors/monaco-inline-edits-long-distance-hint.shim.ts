/**
 * Shim for a monaco-editor internal view module that can go missing.
 *
 * Some installations of `monaco-editor` (especially after a corrupted /
 * partial tarball extraction when a registry mirror is briefly offline) ship
 * the internal module
 * `esm/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/longDistanceHint/inlineEditsLongDistanceHint.js`
 * as missing. `inlineEditsView.js` imports `InlineEditsLongDistanceHint` from it
 * and, because Vite bundles the whole monaco ESM graph starting at
 * `monaco-editor/esm/vs/editor/editor.main.js`, the missing file triggers a hard
 * build failure:
 *
 *   Could not resolve "./inlineEditsViews/longDistanceHint/inlineEditsLongDistanceHint.js"
 *
 * The module only backs the "long distance hint" UI of the inline Copilot
 * feature, which this markdown editor never activates. So we swap in an inert
 * stub via `vite.config.ts` (only when the real file is absent), keeping the
 * build resilient without changing runtime behaviour.
 */

export class InlineEditsLongDistanceHint {}

export function scrollToReveal(): void {
  /* Inert shim – feature is never used by this app. */
}