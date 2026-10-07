/**
 * A `parallel:` branch written as a list that opens with a `parallel:` and
 * goes on (`[{parallel: [A, B]}, C]`): the import keeps it as the
 * `sequence:` group HA reads it as, so the group's markers say which
 * branches C waits for (bug #56), and native writes such an unnamed group,
 * as a whole branch, back as the list (#147: it wrote the group as
 * `sequence:`, so the output changed on its first round trip).
 */
export function opensWithParallel(steps: unknown[]): boolean {
  const [first] = steps;
  return (
    steps.length > 1 &&
    typeof first === 'object' &&
    first !== null &&
    Array.isArray((first as Record<string, unknown>).parallel)
  );
}
