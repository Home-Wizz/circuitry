/**
 * Shared path-building helpers for the canvas's edges — see each export's own
 * doc comment. Both exist for the same underlying reason: xyflow's own
 * `getBezierPath` reads as too flat/straight for this app's taste (see
 * the curvy-connector UI requests that prompted this file, most recently:
 * "these lines should be able to take the shape of as an S etc depending
 * on how the elements are placed") — forward edges barely curve at all
 * when their two
 * handles are level, and backward/loop-back edges routed around nodes via a
 * sharp-cornered polyline read as a boxy rectangle rather than a flowing
 * loop. DeletableEdge.tsx/HintEdge.tsx/ChooseDefaultEdge.tsx and
 * LoopBackEdge.tsx all pull from here rather than duplicating either curve's
 * math (per CLAUDE.md's DRY rule).
 */

export interface EdgePoint {
  x: number;
  y: number;
}

/** How far back from each corner the curve starts, in px — larger reads as a smoother, wider sweep (closer to the reference loops this was modeled on); clamped per-corner to half its shortest adjacent segment so short detours never self-intersect. */
export const DETOUR_CORNER_RADIUS = 70;

/**
 * Minimum handle-to-handle `|dx|` before a loop-back pair earns
 * buildLoopArcPath's wide dome instead of buildLoopBackCurvePath's diagonal
 * "S" — see LoopBackEdge.tsx/DeletableEdge.tsx. A loop-back's source handle
 * always sits on Position.Right, its target always on Position.Left, so
 * *any* vertically-stacked pair — nodes directly above/below each other, no
 * horizontal offset intended at all — still carries a `dx` of roughly one
 * node-width (the app's own repeat_while/until factories default to a
 * 300px cond/body offset) purely from the handles sitting on opposite
 * sides, not because the layout is actually wide. An earlier version of
 * this logic compared that raw `dx` against `dy` directly, which misread
 * *any* plainly-vertical pair as wide the instant its baked-in handle-offset
 * `dx` happened to be larger than `dy` — confirmed against two rounds of
 * real screenshots of the same pair: first when dragged toward better
 * vertical alignment (a large `dx`, but still just a vertical pair), then
 * again for a pair simply sitting close together vertically (a `dx` at the
 * ~300px factory-default baseline, still well under any genuinely
 * deliberate wide horizontal drag). 450 sits safely above that baseline —
 * comfortably more than the app's own default relationship distance — so
 * only a pair someone has actually dragged apart horizontally, not just the
 * handle-side geometry every vertical pair already has for free, gets the
 * dome.
 */
export const WIDE_ARC_MIN_DX = 450;

/**
 * Cubic-bezier path for a normal forward edge (source's Right handle to
 * target's Left handle, target to the right of source — the common case;
 * backward edges route through buildRoundedDetourPath instead).
 *
 * xyflow's own `getBezierPath` places each control point exactly halfway
 * between source and target horizontally, *ignoring* its own `curvature`
 * parameter entirely for this direction (verified against
 * @xyflow/system's `calculateControlOffset` — the curvature-based sqrt
 * formula only applies to the negative-distance/backward case). That
 * control-point placement is mathematically a fine "S" whenever there's
 * vertical offset between the two handles, but reads as barely-curved for
 * modest offsets and perfectly straight when they're level — not the
 * pronounced sweeping curve the reference connectors have.
 *
 * This pulls each control point out further than the xyflow default (a
 * fixed proportion of the horizontal gap, floored so short hops still get a
 * visible bulge) and nudges it slightly extra when there's real vertical
 * offset to travel, so a diagonally-placed pair of nodes swings into a
 * noticeably wider "S" than two nodes sitting at roughly the same height.
 */
function forwardCurvePull(dx: number, dy: number): number {
  return Math.max(Math.abs(dx) * 0.55, 60) + Math.min(Math.abs(dy) * 0.15, 40);
}

/**
 * Handles use consistently sit on Position.Right (source) / Position.Left
 * (target) across every node type in this app, so a control point always
 * extends *outward* from its own handle — rightward from the source,
 * leftward into the target — regardless of which side the other node
 * happens to be on. Almost every edge has the target to the right of the
 * source (the normal left-to-right flow direction), but this stays correct
 * even for the rare case where it isn't (e.g. HintEdge's trigger->case
 * fan-out, which doesn't guarantee left-to-right placement the way a
 * regular flow connection does).
 */
export function buildForwardCurvePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): string {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const pull = forwardCurvePull(dx, dy);
  const sign = dx >= 0 ? 1 : -1;
  const c1x = sourceX + sign * pull;
  const c2x = targetX - sign * pull;
  return `M ${sourceX},${sourceY} C ${c1x},${sourceY} ${c2x},${targetY} ${targetX},${targetY}`;
}

/**
 * Point at t=0.5 along buildForwardCurvePath's cubic bezier, using the same
 * weighting @xyflow/system's own `getBezierEdgeCenter` uses (0.125/0.375/
 * 0.375/0.125 across the four control points) — for edge label placement.
 */
export function getForwardCurveCenter(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): [number, number] {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const pull = forwardCurvePull(dx, dy);
  const sign = dx >= 0 ? 1 : -1;
  const c1x = sourceX + sign * pull;
  const c2x = targetX - sign * pull;
  const centerX = sourceX * 0.125 + c1x * 0.375 + c2x * 0.375 + targetX * 0.125;
  const centerY = sourceY * 0.5 + targetY * 0.5;
  return [centerX, centerY];
}

/**
 * Cubic-bezier "S" path for a loop-back edge (LoopBackEdge.tsx) whose source
 * and target sit roughly in the same vertical column — e.g. a Repeat While/
 * Until block whose condition and body have been dragged into a stack
 * rather than left side-by-side. Deliberately *not* built on
 * buildForwardCurvePath: that helper flips which side each control point
 * bulges toward based on dx's sign, which is correct for a normal
 * left-to-right edge but wrong here — a loop-back's source handle always
 * physically exits *right* (Position.Right) and its target handle always
 * enters from the *left* (Position.Left), regardless of which one ends up
 * above/below or even slightly left/right of the other once dragged. Always
 * bulging the same way (out to the right from source, in from the left to
 * target) is what turns a tall vertical hop into a flowing "S" instead of
 * either a straight line or a curve that doubles back through the nodes.
 * Used when the pair is more vertical than horizontal — see
 * buildLoopArcPath for the other case, a wide/level pair.
 */
export function buildLoopBackCurvePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): string {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  // Floor/dy-factor widened per explicit user request ("could the loops be
  // made to look like my sketch" — a wide, dramatic sweep like the
  // reference canvas the user pointed to) — was 70/0.15/50, read as too
  // tight a wobble for a plain
  // vertical pair. See buildLoopSelfPath below for the separate near-
  // coincident-endpoints case this formula was never meant to cover (a small
  // pull here just produces a squashed pinch, not a loop, once dy is tiny —
  // that case now gets routed to its own dedicated shape instead).
  const pull = Math.max(Math.abs(dx) * 0.4, 110) + Math.min(Math.abs(dy) * 0.25, 70);
  const c1x = sourceX + pull;
  const c2x = targetX - pull;
  return `M ${sourceX},${sourceY} C ${c1x},${sourceY} ${c2x},${targetY} ${targetX},${targetY}`;
}

/**
 * Point at t=0.5 along buildLoopBackCurvePath's cubic bezier (same weighting
 * as getForwardCurveCenter) — for DeletableEdge.tsx's delete-button
 * placement on a backward edge routed through this curve. See that file's
 * doc comment for why a plain sequential edge can end up here alongside
 * genuine loop-backs.
 */
export function getLoopBackCurveCenter(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): [number, number] {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const pull = Math.max(Math.abs(dx) * 0.4, 110) + Math.min(Math.abs(dy) * 0.25, 70);
  const c1x = sourceX + pull;
  const c2x = targetX - pull;
  const centerX = sourceX * 0.125 + c1x * 0.375 + c2x * 0.375 + targetX * 0.125;
  const centerY = sourceY * 0.5 + targetY * 0.5;
  return [centerX, centerY];
}

/**
 * Smooth single-cubic arc for a loop-back edge (LoopBackEdge.tsx) whose pair
 * is wider than it is tall — a Repeat While/Until condition and body left
 * side by side, or dragged apart horizontally. Per explicit user request
 * ("I would like the loops to still be S shaped even if the nodes are
 * wider... the reference canvas only does the S loops"), this replaces what
 * used to be a `buildRoundedDetourPath` polyline (straight segments over
 * the top with small quarter-circle fillets at each corner) — technically
 * correct at avoiding the nodes, but reads as a boxy rectangle rather than
 * a flowing loop.
 *
 * Both control points are pulled up to the same `peakY`, well above
 * whichever endpoint is already higher, *not* just each endpoint's own Y
 * the way buildLoopBackCurvePath's are — with source and target roughly
 * level, control points at their own Y would barely lift the curve at all
 * (a wide, nearly-straight wobble that visually cuts back through the row
 * it's supposed to loop over). Pulling both up to a shared peak is what
 * turns that into a proper arch that clears the nodes, while the outward
 * horizontal pull at each end keeps the tangents leaving/entering roughly
 * the same direction the Right/Left handles face.
 */
export function buildLoopArcPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): string {
  const dx = targetX - sourceX;
  // Widened alongside buildLoopBackCurvePath's constants above, same "make
  // it read as a wide sweep, not a shallow wobble" request.
  const rise = Math.min(200, Math.max(100, Math.abs(dx) * 0.28));
  const peakY = Math.min(sourceY, targetY) - rise;
  const pull = Math.max(Math.abs(dx) * 0.3, 90);
  const c1x = sourceX + pull;
  const c2x = targetX - pull;
  return `M ${sourceX},${sourceY} C ${c1x},${peakY} ${c2x},${peakY} ${targetX},${targetY}`;
}

/**
 * Point at t=0.5 along buildLoopArcPath's cubic bezier (same weighting as
 * getForwardCurveCenter) — for DeletableEdge.tsx's delete-button placement
 * on a backward-but-level edge routed through this curve.
 */
export function getLoopArcCenter(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): [number, number] {
  const dx = targetX - sourceX;
  const rise = Math.min(200, Math.max(100, Math.abs(dx) * 0.28));
  const peakY = Math.min(sourceY, targetY) - rise;
  const pull = Math.max(Math.abs(dx) * 0.3, 90);
  const c1x = sourceX + pull;
  const c2x = targetX - pull;
  const centerX = sourceX * 0.125 + c1x * 0.375 + c2x * 0.375 + targetX * 0.125;
  const centerY = sourceY * 0.125 + peakY * 0.375 + peakY * 0.375 + targetY * 0.125;
  return [centerX, centerY];
}

/**
 * Below this straight-line distance between a loop-back pair's two handles,
 * buildLoopBackCurvePath/buildLoopArcPath's own pull math degenerates — see
 * buildLoopSelfPath's doc comment — so LoopBackEdge.tsx/DeletableEdge.tsx
 * route through that dedicated shape instead once source and target are
 * this close together.
 *
 * Was 140 — per direct user feedback comparing two real screenshots at
 * different node spacings, that caught pairs with a clearly visible gap
 * between them (which buildLoopBackCurvePath's now-widened 110px floor
 * pull already renders as a perfectly good diagonal "S") and routed them
 * through the self-loop bulge instead, which should only kick in once the
 * two node cards are genuinely overlapping/adjacent. Lowered to 70 —
 * matching DETOUR_CORNER_RADIUS's precedent in this same file for "the two
 * things are essentially touching" — so only that much tighter case gets
 * the dedicated shape.
 */
export const LOOP_SELF_DISTANCE_THRESHOLD = 70;

/**
 * Fixed-size loop for a loop-back pair whose two node cards sit nearly on
 * top of each other (confirmed real case: a Repeat block whose condition
 * node was dragged — or auto-laid-out on import — to almost the same
 * position as its body, e.g. a lone "Wait for" body with its own condition
 * hidden right behind it). buildLoopBackCurvePath/buildLoopArcPath both pull
 * their control points a fraction of dx/dy *away* from the endpoints — fine
 * for a normally-spaced pair, but when dx and dy are both tiny there's
 * nothing to scale from, so even their floor values produce a squashed,
 * nearly-flat "S" that reads as a pinch rather than an open loop.
 *
 * This ignores dx/dy's magnitude entirely and always bulges out to the
 * right by a fixed, generous radius — the same direction a loop-back's
 * source handle already exits from (Position.Right) — so the loop stays
 * clearly readable no matter how close together (or even exactly
 * coincident) the two endpoints are.
 */
export function buildLoopSelfPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): string {
  // 150, not a smaller value that just barely clears the node — per
  // explicit user request/reference screenshot (the reference editor's
  // own self-loop), the loop needs to read as clearly bigger than the
  // node itself, sweeping
  // well past its edge and well above/below it, not a small knot tucked
  // against one corner.
  const R = 150;
  const rightX = Math.max(sourceX, targetX) + R;
  return `M ${sourceX},${sourceY} C ${rightX},${sourceY - R} ${rightX},${targetY + R} ${targetX},${targetY}`;
}

/** Point at t=0.5 along buildLoopSelfPath's cubic bezier (same weighting as getForwardCurveCenter) — for delete-button placement. */
export function getLoopSelfCenter(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): [number, number] {
  const R = 150; // must match buildLoopSelfPath's R
  const rightX = Math.max(sourceX, targetX) + R;
  const centerX = sourceX * 0.125 + rightX * 0.375 + rightX * 0.375 + targetX * 0.125;
  const centerY = sourceY * 0.125 + (sourceY - R) * 0.375 + (targetY + R) * 0.375 + targetY * 0.125;
  return [centerX, centerY];
}

/**
 * Rectangular "route around the top" loop for a backward edge whose source
 * and target sit level (or nearly level) with each other — e.g. a Repeat
 * While/Until block's cond->body edge when the pair is left side by side.
 * Per explicit user request, restoring the original boxy detour for this
 * specific level case: a plain straight line drawn directly through the two
 * node cards reads fine on its own, but once a LoopBackEdge dashed line is
 * also present between the same two handles (closing the loop back the
 * other way), the two edges sit exactly on top of each other and become
 * visually indistinguishable. Routing this one up and over instead keeps
 * both lines readable — the dashed line stays a clean straight "close the
 * loop" connector, and this one reads as the actual step-to-step flow arcing
 * around it, the way it did before the brief straight-line experiment.
 * Reuses buildRoundedDetourPath for the actual corner-rounded polyline
 * rather than duplicating that math.
 */
export function buildLoopDetourPath(sourceX: number, sourceY: number, targetX: number, targetY: number): string {
  const BUMP = 40;
  const RISE = 60;
  const topY = Math.min(sourceY, targetY) - RISE;
  const points: EdgePoint[] = [
    { x: sourceX, y: sourceY },
    { x: sourceX + BUMP, y: sourceY },
    { x: sourceX + BUMP, y: topY },
    { x: targetX - BUMP, y: topY },
    { x: targetX - BUMP, y: targetY },
    { x: targetX, y: targetY },
  ];
  return buildRoundedDetourPath(points);
}

/**
 * Delete-button placement for buildLoopDetourPath above — the midpoint of
 * its top rail, roughly where a person would expect to grab/click the loop.
 */
export function getLoopDetourCenter(sourceX: number, sourceY: number, targetX: number, targetY: number): [number, number] {
  const BUMP = 40;
  const RISE = 60;
  const topY = Math.min(sourceY, targetY) - RISE;
  const centerX = (sourceX + BUMP + (targetX - BUMP)) / 2;
  return [centerX, topY];
}

/**
 * Builds an SVG path through an ordered list of waypoints, replacing every
 * interior corner with a quadratic Bezier arc of `radius` px (clamped to
 * half the length of its shortest adjacent segment). Two points fall back to
 * a straight line; fewer than two returns an empty path.
 */
export function buildRoundedDetourPath(points: EdgePoint[], radius: number = DETOUR_CORNER_RADIUS): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }

  let path = `M ${points[0].x},${points[0].y} `;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const segInLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const segOutLen = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(radius, segInLen / 2, segOutLen / 2);

    const inX = curr.x - ((curr.x - prev.x) / (segInLen || 1)) * r;
    const inY = curr.y - ((curr.y - prev.y) / (segInLen || 1)) * r;
    const outX = curr.x + ((next.x - curr.x) / (segOutLen || 1)) * r;
    const outY = curr.y + ((next.y - curr.y) / (segOutLen || 1)) * r;

    path += `L ${inX},${inY} Q ${curr.x},${curr.y} ${outX},${outY} `;
  }

  const last = points[points.length - 1];
  path += `L ${last.x},${last.y}`;

  return path;
}
