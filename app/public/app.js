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
  document.querySelectorAll('select[data-autosubmit], input[data-autosubmit]').forEach((select) => {
    select.addEventListener('change', () => select.form.submit());
  });

  // 3c. Opportunity type: the form shows the fields the chosen type uses, and any field that already has a value.
  document.querySelectorAll('select[name="type"]').forEach((select) => {
    const apply = () => {
      document.querySelectorAll('[data-types]').forEach((el) => {
        const types = el.dataset.types.split('|');
        el.hidden = !(types.includes(select.value) || el.dataset.filled === 'yes');
      });
    };
    select.addEventListener('change', apply);
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

  // 5b. Type to confirm: a delete form keeps its button disabled until the typed text matches the record (partials/delete-form.ejs).
  document.querySelectorAll('form[data-type-to-confirm]').forEach((form) => {
    const input = form.querySelector('input[name="confirm"]');
    const button = form.querySelector('button[type="submit"]');
    const sync = () => { button.disabled = input.value.trim() !== form.dataset.typeToConfirm; };
    input.addEventListener('input', sync);
    sync();
  });

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
    const button = event.target.closest('[data-copy], [data-copy-from]');
    if (!button) return;
    const text = button.dataset.copyFrom
      ? document.getElementById(button.dataset.copyFrom).value
      : button.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      const original = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = original; }, 1500);
    } catch (_) {
      // clipboard not available: nothing to do
    }
  });

  // 3. Reveal: a button with data-reveal="id" shows or hides the element with that id. Used for
  //    the outcome reason forms (§11.4 stage stepper) and the inline next-action updates on the dashboard.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-reveal]');
    if (!button) return;
    const target = document.getElementById(button.dataset.reveal);
    if (!target) return;
    const open = target.hidden;
    target.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) target.querySelector('input, select, textarea')?.focus();
  });

  // 3b. Keyboard shortcuts, ignored while typing: "/" search, "n" new opportunity, "g d" dashboard, "g l" opportunities list, "g s" RFQs I support.
  let gPending = false;
  let gTimer = null;
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const typing = event.target.closest('input, select, textarea, [contenteditable="true"]');
    if (typing) return;
    const key = event.key.toLowerCase();
    if (gPending) {
      gPending = false;
      clearTimeout(gTimer);
      if (key === 'd') window.location.href = '/';
      if (key === 'l') window.location.href = '/opportunities';
      if (key === 's') window.location.href = '/support';
      return;
    }
    if (key === '/') {
      const search = document.querySelector('input[type="search"][name="q"]');
      if (search) { event.preventDefault(); search.focus(); }
    } else if (key === 'n') {
      window.location.href = '/opportunities/new';
    } else if (key === 'g') {
      gPending = true;
      gTimer = setTimeout(() => { gPending = false; }, 1000);
    }
  });

  // 10. Install: the service worker caches the static files so the installed app loads fast.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  // 11. Board: drag a card onto a lane to move it to that stage. The stage route does the work, then the board reloads.
  document.querySelectorAll('[data-kanban-card]').forEach((card) => {
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', card.dataset.id);
      event.dataTransfer.effectAllowed = 'move';
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
  });
  document.querySelectorAll('.board-lane').forEach((lane) => {
    lane.addEventListener('dragover', (event) => {
      event.preventDefault();
      lane.classList.add('is-over');
    });
    lane.addEventListener('dragleave', () => lane.classList.remove('is-over'));
    lane.addEventListener('drop', async (event) => {
      event.preventDefault();
      lane.classList.remove('is-over');
      const id = event.dataTransfer.getData('text/plain');
      const card = document.querySelector(`[data-kanban-card][data-id="${id}"]`);
      if (!card || card.dataset.stage === lane.dataset.stage) return;
      if (lane.dataset.outcome === 'lost' || lane.dataset.outcome === 'dropped') {
        window.alert('Lost and Dropped need a reason. The opportunity will open so you can choose one.');
        window.location.href = `/opportunities/${id}`;
        return;
      }
      const body = new URLSearchParams({ stage: lane.dataset.stage });
      try {
        const res = await fetch(`/opportunities/${id}/stage`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        });
        if (!res.ok) throw new Error(res.statusText);
        window.location.reload();
      } catch (_) {
        window.alert('The stage could not be changed. Try again.');
      }
    });
  });

  // 9. Outcome reason: "Mark Lost…" and "Mark Dropped…" use the reveal above (data-reveal="outcome-Lost").
})();
