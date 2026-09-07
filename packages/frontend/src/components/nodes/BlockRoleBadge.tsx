/**
 * Small floating pill above a node card identifying its role within a
 * compound block — "Case 1 / 2" for a Choose case, "If"/"Then"/"Else" for
 * If/Else, "While"/"Until" for Repeat's condition, "Do" for Repeat's body,
 * "Branch 1"/"Branch 2" for Parallel. Originally only Choose had this
 * (ConditionNode.tsx's `chooseCase`/`chooseCaseTotal` badge); extracted here
 * so every compound block's nodes — both ConditionNode.tsx and
 * ActionNode.tsx — show their role the same way, per user request to apply
 * the same design everywhere rather than just inlining the role into the
 * title text (which would get lost/overwritten once a real alias or the
 * resolved condition/action summary takes over the title line).
 */
export function BlockRoleBadge({ label }: { label: string }) {
  return (
    <div className="absolute -top-3 left-2 rounded-full bg-primary px-2 py-0.5 font-medium text-primary-foreground text-[10px] shadow-sm">
      {label}
    </div>
  );
}
