// Work Tracker — small browser behaviours (PLAN.md §11.7, features 5–7). No build step, no dependencies.
(() => {
  'use strict';

  // 5. Confirm before actions marked with data-confirm="…" (buttons, links or forms).
  document.addEventListener(
    'click',
    (event) => {
      const el = event.target.closest('a[data-confirm], button[data-confirm]');
      if (el && !window.confirm(el.dataset.confirm)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;
      if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) event.preventDefault();
    },
    true,
  );

  // 6. Toasts: success messages hide after 4 s. Every toast can be closed.
  document.querySelectorAll('.toast-success').forEach((toast) => {
    setTimeout(() => toast.remove(), 4000);
  });
  document.addEventListener('click', (event) => {
    const close = event.target.closest('.toast-close');
    if (close) close.closest('.toast').remove();
  });

  // 7. Sync badge: refresh the status every 10 seconds.
  const badge = document.getElementById('sync-badge');
  const label = (s) => {
    switch (s.state) {
      case 'synced': return 'Synced';
      case 'pending': return `${s.unpushed} unpushed`;
      case 'error': return 'Sync error';
      case 'local': return 'Local only';
      case 'offline': return 'Offline';
      default: return s.state;
    }
  };
  const refreshSyncBadge = async () => {
    if (!badge) return;
    try {
      const res = await fetch('/api/sync/status', { cache: 'no-store' });
      if (!res.ok) return;
      const status = await res.json();
      badge.dataset.state = status.state;
      badge.querySelector('.label').textContent = label(status);
      badge.title = status.lastError || '';
    } catch (_) {
      // server stopped or unreachable: keep the last known state
    }
  };
  setInterval(refreshSyncBadge, 10000);
})();
