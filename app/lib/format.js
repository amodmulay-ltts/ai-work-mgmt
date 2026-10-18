/**
 * View helpers. Exposed to every template through app.locals.
 * Phase 1 adds date, money and health helpers (PLAN.md §11.6).
 */

/**
 * Text for the header sync badge.
 * @param {{ state: string, unpushed: number }} sync
 */
export function syncLabel(sync) {
  switch (sync.state) {
    case 'synced':
      return 'Synced';
    case 'pending':
      return `${sync.unpushed} unpushed`;
    case 'error':
      return 'Sync error';
    case 'local':
      return 'Local only';
    case 'offline':
      return 'Offline';
    default:
      return sync.state;
  }
}
