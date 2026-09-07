import type { TFunction } from 'i18next';

// Both call sites (ConditionNode.tsx, ActionNode.tsx) load `useTranslation(['nodes'])`,
// so this matches their `t`'s exact branded type rather than the bare `TFunction`
// default (which resolves to a different namespace and rejects these calls).
type TranslateFn = TFunction<readonly ['nodes']>;

/**
 * The floating role badge (see components/nodes/BlockRoleBadge.tsx) text for
 * a condition node inside a compound block — Choose's numbered cases already
 * had this via `_chooseCase`/`_chooseCaseTotal`; If/Else and Repeat
 * While/Until's own condition now get the same treatment ("If", "While",
 * "Until") so every compound block's role is visible on the canvas the same
 * way, configured or not. Returns `undefined` for a condition node that
 * isn't part of any compound block (a plain standalone condition never shows
 * a role badge).
 */
export function getConditionRoleLabel(
  blockKey: string | undefined,
  chooseCase: number | undefined,
  chooseCaseTotal: number | undefined,
  t: TranslateFn,
  conditionType?: string
): string | undefined {
  if (blockKey === 'choose') {
    return chooseCase !== undefined && chooseCaseTotal !== undefined
      ? t('nodes:conditions.caseLabel', { index: chooseCase, total: chooseCaseTotal })
      : undefined;
  }
  if (blockKey === 'if_else') return t('nodes:conditions.ifRoleLabel');
  if (blockKey === 'repeat_while') return t('nodes:conditions.whileRoleLabel');
  if (blockKey === 'repeat_until') return t('nodes:conditions.untilRoleLabel');
  // AND/OR/NOT groups (lib/conditionRecipes.ts's CONDITION_BLOCKS) carry no
  // `_blockKey` at all — they're identified by `data.condition` instead, so
  // this branch is keyed on the caller-supplied condition type rather than
  // blockKey like everything above.
  if (conditionType === 'and') return t('nodes:conditions.andRoleLabel');
  if (conditionType === 'or') return t('nodes:conditions.orRoleLabel');
  if (conditionType === 'not') return t('nodes:conditions.notRoleLabel');
  return undefined;
}

/**
 * Same idea as getConditionRoleLabel, for an action node's role — If/Else's
 * two branches ("Then"/"Else", via `_ifElseBranch`), Repeat While/Until's
 * loop body ("Do"), Parallel's numbered branches ("Branch 1"/"Branch 2", via
 * `_parallelBranch`). Returns `undefined` for an action node that isn't part
 * of any compound block.
 */
export function getActionRoleLabel(
  blockKey: string | undefined,
  ifElseBranch: unknown,
  parallelBranch: unknown,
  t: TranslateFn
): string | undefined {
  if (blockKey === 'if_else') {
    return ifElseBranch === 'else' ? t('nodes:actions.elseRoleLabel') : t('nodes:actions.thenRoleLabel');
  }
  if (blockKey === 'repeat_while' || blockKey === 'repeat_until') {
    return t('nodes:actions.doRoleLabel');
  }
  if (blockKey === 'parallel') {
    return typeof parallelBranch === 'number'
      ? t('nodes:actions.branchRoleLabel', { index: parallelBranch })
      : undefined;
  }
  return undefined;
}
