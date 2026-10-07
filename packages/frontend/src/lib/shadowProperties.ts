/**
 * Tailwind v4 declares its utility variables (`--tw-border-style`,
 * `--tw-shadow`, `--tw-ring-shadow`...) with `@property` rules and gives them
 * their starting values there. Browsers ignore `@property` inside a shadow
 * root, and the HA panel's styles live in one (panel-wrapper.ts), so every
 * `border` and `ring` utility resolved to nothing there: no border style, no
 * ring. Registered in the page's own document, the same rules apply inside
 * every shadow root too.
 */
const PROPERTY_RULE = /@property\s+--[\w-]+\s*\{[^}]*\}/g;

/** The id of the page-level style holding Circuitry's `@property` rules. */
export const PROPERTY_STYLE_ID = 'circuitry-css-properties';

/** Every `@property` rule in a stylesheet's text, one per line. */
export function propertyRules(css: string): string {
  return (css.match(PROPERTY_RULE) ?? []).join('\n');
}

/** Adds the stylesheet's `@property` rules to the document once. */
export function registerPropertiesInDocument(css: string, doc: Document = document): void {
  if (doc.getElementById(PROPERTY_STYLE_ID)) return;
  const rules = propertyRules(css);
  if (!rules) return;
  const style = doc.createElement('style');
  style.id = PROPERTY_STYLE_ID;
  style.textContent = rules;
  doc.head.appendChild(style);
}
