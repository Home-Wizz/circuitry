import type { PickerIcon } from '@/components/nodes/StepIcon';
import type { NavRow, NavSection } from '@/components/canvas/PickerColumns';
import type { DomainColor } from '@/lib/domain-colors';
import { INLINE_GROUP_MAX } from '@/lib/pickerLayout';

/**
 * The pieces of the pickers' first column (lib/pickerLayout.ts has the
 * order): a group listed inline when it's small, and a section's heading.
 */

export interface GroupHead {
  key: string;
  label: string;
  icon?: PickerIcon;
  color?: DomainColor;
}

/** A group's section: its rows under its name when there are three or
 * fewer, otherwise one row that opens them; nothing when it has none. */
export function groupSections(head: GroupHead, rows: NavRow[], open: () => void): NavSection[] {
  if (rows.length === 0) return [];
  if (rows.length <= INLINE_GROUP_MAX) return [{ subtitle: head.label, rows }];
  return [
    {
      rows: [
        { key: head.key, label: head.label, icon: head.icon, color: head.color, onDrill: open },
      ],
    },
  ];
}

/** Sections under one heading: the heading goes on the first that has rows. */
export function headed(title: string, sections: NavSection[]): NavSection[] {
  const first = sections.findIndex((s) => s.rows.length > 0);
  return sections.map((s, i) => (i === first ? { ...s, title } : s));
}
