import { useEffect, useState } from 'react';

/**
 * `value`, once it has stayed the same for `delayMs`: a burst of changes (a
 * card being dragged, typing) gives one update after it, not one each.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
