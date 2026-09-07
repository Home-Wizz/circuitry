/**
 * Converts an arbitrary CSS color string (hex, rgb(), hsl(), named color,
 * `rgba(var(--x), 0.4)`, ...) into the bare "H S% L%" triplet format used by
 * our Tailwind color tokens (`hsl(var(--x))`).
 *
 * Resolution goes through a real, DOM-attached probe element and
 * `getComputedStyle` rather than a detached `<canvas>` — some HA themes
 * (layered "glassmorphism" themes like "Vision OS" in particular) define
 * their color tokens as `rgba()`/`hsl(... / N%)` wrapping a further
 * `var(--some-rgb-triplet)` reference, for a translucent look. A detached
 * canvas has no ancestor to inherit that inner custom property from, so
 * `ctx.fillStyle = color` silently fails (an invalid assignment is a no-op
 * per the Canvas spec) and the color read back as whatever the probe
 * happened to be left at — which, combined with a bug in the alpha handling
 * this replaced, was reading back as solid black. That made Circuitry's own
 * solid-fill UI (e.g. `bg-primary`, used by the "Open Automation" button)
 * render fully invisible — black fill on the equally-black panel — whenever
 * Circuitry's theme override was 'auto' and mirroring a theme like that (in
 * 'light'/'dark' override modes this never came up, since those bypass the
 * real theme's values entirely and use Circuitry's own fixed fallback
 * colors — see ha-theme.ts's HA_THEME_TOKENS).
 *
 * `context` should be the same element the resulting variable will actually
 * be applied to (normally the app root) so any such nested `var()`
 * reference resolves in the exact cascade it'll really be read in, rather
 * than an arbitrary one.
 */
export function toHslTriplet(color: string, context: HTMLElement = document.body): string | null {
  const rgb = normalizeToRgb(color, context);
  if (!rgb) return null;
  const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return `${h} ${s}% ${l}%`;
}

function normalizeToRgb(
  color: string,
  context: HTMLElement
): { r: number; g: number; b: number } | null {
  const probe = document.createElement('span');
  // Kept out of layout/paint — only `color` is ever read back, via
  // getComputedStyle, never rendered.
  probe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;';
  probe.style.color = color;
  context.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();

  const match = resolved.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/
  );
  if (!match) return null;

  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  // getComputedStyle always resolves to an rgb()/rgba() string regardless of
  // the input syntax (hex, hsl(), named, ...), with alpha broken out
  // explicitly (defaults to 1 for fully opaque input) — no separate
  // transparency-detection heuristic needed.
  const a = match[4] === undefined ? 1 : Number(match[4]);

  // Flatten translucent colors onto a white backdrop so a theme's
  // glass-style alpha colors read back as a sensible opaque approximation
  // instead of (pre-alpha-aware) black or (post-alpha-aware, wrong
  // backdrop) some other arbitrary color Circuitry's own background isn't
  // guaranteed to match anyway.
  return {
    r: Math.round(r * a + 255 * (1 - a)),
    g: Math.round(g * a + 255 * (1 - a)),
    b: Math.round(b * a + 255 * (1 - a)),
  };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, Math.round(l * 100)];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    default:
      h = (rn - gn) / d + 4;
      break;
  }
  h *= 60;

  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}
