/**
 * The candidates no OTHER candidate reaches, in their given order: where
 * branches meet, the meeting points that aren't downstream of another one.
 *
 * `successors` gives a node's forward next nodes; a node `isBoundary` says
 * is still reached but not walked past (nor walked from, as a start).
 *
 * Equal to asking, for each pair, whether one reaches the other (a walk per
 * pair), but in one walk: every node records up to two of the candidates it
 * is reached from, which is enough to tell whether one of them isn't
 * itself. The pairwise walks made a long automation's save take minutes
 * (bug #224).
 */
export function undominated(
  candidates: string[],
  successors: (id: string) => Iterable<string>,
  isBoundary: (id: string) => boolean
): string[] {
  const reachedFrom = new Map<string, string[]>();
  const queue: Array<[string, string]> = [];
  const reach = (node: string, origin: string) => {
    const origins = reachedFrom.get(node) ?? [];
    if (origins.length >= 2 || origins.includes(origin)) return;
    origins.push(origin);
    reachedFrom.set(node, origins);
    if (!isBoundary(node)) queue.push([node, origin]);
  };
  for (const c of new Set(candidates)) {
    if (isBoundary(c)) continue;
    for (const next of successors(c)) reach(next, c);
  }
  for (let i = 0; i < queue.length; i++) {
    const [node, origin] = queue[i];
    for (const next of successors(node)) reach(next, origin);
  }
  return candidates.filter((c) => !(reachedFrom.get(c) ?? []).some((o) => o !== c));
}
