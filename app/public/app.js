// Work Tracker — small browser behaviours (PLAN.md §11.7). Vanilla JS, no build step, no dependencies.
(() => {
  'use strict';

  // 1. Clickable rows: a row with data-href opens its page, unless the click was on a control.
  document.addEventListener('click', (event) => {
    if (event.target.closest('a, button, input, select, textarea, label, form')) return;
    const row = event.target.closest('tr[data-href]');
    if (row) window.location.href = row.dataset.href;
  });

  // 2. Auto-submit: a select with data-autosubmit submits its form when it changes.
  document.querySelectorAll('select[data-autosubmit]').forEach((select) => {
    select.addEventListener('change', () => select.form.submit());
  });

  // 4. Unsaved changes: forms with data-guard warn before the page is left after an edit.
  document.querySelectorAll('form[data-guard]').forEach((form) => {
    let dirty = false;
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('change', () => { dirty = true; });
    form.addEventListener('submit', () => { dirty = false; });
    window.addEventListener('beforeunload', (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  });

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

  // 8. Copy: a [data-copy] button copies its value and shows "Copied" briefly.
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      const original = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = original; }, 1500);
    } catch (_) {
      // clipboard not available: nothing to do
    }
  });

  // 9. Outcome reason: "Mark Lost…" and "Mark Dropped…" open the reason form inline.
  document.querySelectorAll('[data-outcome-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const form = document.querySelector(`.outcome-form[data-outcome="${button.dataset.outcomeToggle}"]`);
      if (!form) return;
      const open = form.hidden;
      form.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (open) form.querySelector('select').focus();
    });
  });
})();
