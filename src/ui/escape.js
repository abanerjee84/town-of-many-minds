/**
 * Phase 29 (S19a) — the one HTML-escape helper, in one place.
 *
 * Why this file exists: `hud.js` and `interaction.js` each carried their own
 * `esc`, and they had drifted — the HUD's did not cover `'` (fine in element
 * text, wrong in an attribute), the interaction's did. Model-authored text
 * reaches these sinks: a council reply's `name=` becomes `b.name`, which the
 * inspector heading, the citizen's Home/Workplace rows and the log panel all
 * interpolate. Two drifting copies is how the two holes got there.
 *
 * `esc` is for SINK-side safety and is deliberately total: it is correct in
 * element text, in a quoted attribute, and inside a single-quoted one. The
 * other half of the fix is at the PARSER (`cleanName` in governance.js) — this
 * alone would still let a 4KB name reach the DOM.
 */
export function esc(v) {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/**
 * Escape for a text node only — same output today, kept as a distinct name so
 * a call site can say which context it is reasoning about. Attribute values
 * must use `esc`.
 */
export const escText = esc;
