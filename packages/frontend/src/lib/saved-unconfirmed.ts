/**
 * A save Home Assistant took but that couldn't be confirmed: it stored
 * something other than what was sent, or couldn't set the automation up.
 * The save failed, but Home Assistant holds `stored` under `automationId`
 * now -- the tab's own write, not a change made elsewhere (bug #270).
 */
export class SavedUnconfirmedError extends Error {
  constructor(
    message: string,
    readonly automationId: string,
    readonly stored: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SavedUnconfirmedError';
  }
}
