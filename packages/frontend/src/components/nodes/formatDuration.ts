import type { DurationValue } from '@/components/panels/node-fields/DurationField';

// Shared duration formatting for Delay and Wait nodes
export function formatDuration(val: DurationValue | undefined): string {
  // A number is seconds (`delay: 5`, `delay: 1.5`), as HA reads it.
  if (typeof val === 'number') return `${val}s`;
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    const parts = [];
    if (val.hours) parts.push(`${val.hours}h`);
    if (val.minutes) parts.push(`${val.minutes}m`);
    if (val.seconds) parts.push(`${val.seconds}s`);
    if (val.milliseconds) parts.push(`${val.milliseconds}ms`);
    return parts.join(' ') || '0s';
  }
  return String(val);
}
