// ==========================================================
// MAXO panel frontend — single-page dashboard, no build step.
// ==========================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('auth_required');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || 'request_failed');
  }
  return data;
}

// ---------------- unicode "fancy font" preview (mirrors bot.py FONT_MAPS) ----------------

const FONT_MAPS = {
  1: { upper: 0x1D5D4, lower: 0x1D5EE, digit: 0x1D7EC },
  2: { upper: 0x1D400, lower: 0x1D41A, digit: 0x1D7CE },
  3: { upper: 0x1D670, lower: 0x1D68A, digit: 0x1D7F6 },
  4: { upper: 0x1D5A0, lower: 0x1D5BA, digit: 0x1D7E2 },
};

function applyFont(text, font) {
  const map = FONT_MAPS[font] || FONT_MAPS[1];
  let out = '';
  for (const ch of text) {
    if (ch >= 'A' && ch <= 'Z') out += String.fromCodePoint(map.upper + (ch.charCodeAt(0) - 65));
    else if (ch >= 'a' && ch <= 'z') out += String.fromCodePoint(map.lower + (ch.charCodeAt(0) - 97));
    else if (ch >= '0' && ch <= '9') out += String.fromCodePoint(map.digit + (ch.charCodeAt(0) - 48));
    else out += ch;
  }
  return out;
}

function clock12h() {
  const now = new Date();
  let h = now.getHours() % 12;
  if (h === 0) h = 12;
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// ---------------- tabs ----------------

function initTabs() {
  $$('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab').forEach((b) => b.classList.remove('active'));
      $$('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`.panel[data-panel="${btn.dataset.tab}"]`).classList.add('active');
      loadPanel(btn.dataset.tab);
    });
  });
}

const loaded = new Set();

function loadPanel(name) {
  if (name === 'overview') return loadOverview();
  if (name === 'autoreply') return loadAutoReply();
  if (name === 'clock') return loadClock();
  if (name === 'block') return loadBlockList();
  if (name === 'mute') return loadMuteList();
  if (name === 'chats') return loadChats();
  if (name === 'deleted') return loadDeleted(1);
}

// ---------------- overview ----------------

const STAT_LABELS = [
  ['replies_total', 'پاسخ‌های ارسال‌شده'],
  ['received_total', 'پیام دریافتی'],
  ['chats_count', 'مکالمات ثبت‌شده'],
  ['unanswered_count', 'PV بدون پاسخ'],
  ['blocked_count', 'کاربر بلاک‌شده'],
  ['muted_count', 'کاربر ساکت‌شده'],
  ['deleted_total', 'پیام حذف‌شده (کل)'],
  ['cached_pending', 'در حال رصد'],
];

async function loadOverview() {
  const { data } = await api('/api/stats');
  const grid = $('#statGrid');
  grid.innerHTML = '';
  STAT_LABELS.forEach(([key, label]) => {
    const cell = document.createElement('div');
    cell.className = 'stat-cell';
    cell.innerHTML = `<div class="stat-num">${data[key] ?? 0}</div><div class="stat-label">${label}</div>`;
    grid.appendChild(cell);
  });

  const flags = [
    [data.auto_reply, 'پاسخ خودکار'],
    [data.name_clock, 'ساعت در اسم'],
    [data.bio_clock, 'ساعت در بیو'],
    [data.archive_enabled, 'آرشیو حذف‌شده'],
  ];
  flags.forEach(([on, label]) => {
    const cell = document.createElement('div');
    cell.className = 'stat-cell' + (on ? ' on' : '');
    cell.innerHTML = `<div class="stat-num">${on ? 'روشن' : 'خاموش'}</div><div class="stat-label">${label}</div>`;
    grid.appendChild(cell);
  });
}

// ---------------- auto reply ----------------

async function loadAutoReply() {
  const { data } = await api('/api/auto-reply');
  $('#editor').innerHTML = data.html || '';
  const toggle = $('#autoReplyToggle');
  toggle.checked = data.enabled;
  $('#autoReplyLabel').textContent = data.enabled ? 'روشن' : 'خاموش';
}

function initAutoReply() {
  const editor = $('#editor');

  $$('.toolbar [data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editor.focus();
      if (btn.dataset.cmd === 'bold') {
        document.execCommand('bold');
      } else if (btn.dataset.cmd === 'blockquote') {
        document.execCommand('formatBlock', false, 'blockquote');
      }
    });
  });

  $('#autoReplyToggle').addEventListener('change', async (e) => {
    $('#autoReplyLabel').textContent = e.target.checked ? 'روشن' : 'خاموش';
    await api('/api/auto-reply/toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled: e.target.checked }),
    });
  });

  $('#saveAutoReply').addEventListener('click', async () => {
    const btn = $('#saveAutoReply');
    btn.disabled = true;
    try {
      await api('/api/auto-reply', {
        method: 'POST',
        body: JSON.stringify({ html: editor.innerHTML }),
      });
      const flag = $('#autoReplySaved');
      flag.hidden = false;
      setTimeout(() => (flag.hidden = true), 1800);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------------- name / bio clock ----------------

async function loadClock() {
  const { data } = await api('/api/stats');
  $('#nameClockToggle').checked = data.name_clock;
  $('#nameFont').value = data.name_font;
  $('#nameLabel').value = data.name_label || 'MAXO';
  $('#bioClockToggle').checked = data.bio_clock;
  $('#bioFont').value = data.bio_font;
  updateNamePreview();
  updateBioPreview();
}

function updateNamePreview() {
  const label = $('#nameLabel').value || 'MAXO';
  const font = Number($('#nameFont').value || 1);
  $('#namePreview').textContent = applyFont(`${label} | ${clock12h()}`, font);
}

function updateBioPreview() {
  const font = Number($('#bioFont').value || 1);
  $('#bioPreview').textContent = applyFont(`TIME : ${clock12h()}`, font);
}

function initClock() {
  $('#nameLabel').addEventListener('input', updateNamePreview);
  $('#nameFont').addEventListener('change', updateNamePreview);
  $('#bioFont').addEventListener('change', updateBioPreview);

  $('#saveNameClock').addEventListener('click', async () => {
    await api('/api/name-clock', {
      method: 'POST',
      body: JSON.stringify({
        enabled: $('#nameClockToggle').checked,
        font: Number($('#nameFont').value),
        label: $('#nameLabel').value,
      }),
    });
  });

  $('#saveBioClock').addEventListener('click', async () => {
    await api('/api/bio-clock', {
      method: 'POST',
      body: JSON.stringify({
        enabled: $('#bioClockToggle').checked,
        font: Number($('#bioFont').value),
      }),
    });
  });
}

// ---------------- block list ----------------

async function loadBlockList() {
  const { data } = await api('/api/blocklist');
  const body = $('#blockTableBody');
  body.innerHTML = '';
  $('#blockEmpty').hidden = data.length > 0;
  data.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(row.name || '—')}</td>
      <td class="mono">${row.username ? '@' + escapeHtml(row.username) : '—'}</td>
      <td class="mono">${row.user_id}</td>
      <td class="mono">${escapeHtml(row.created_at || '')}</td>
      <td><button class="link-action" data-id="${row.user_id}">آنبلاک</button></td>
    `;
    tr.querySelector('.link-action').addEventListener('click', async (e) => {
      e.target.disabled = true;
      await api('/api/unblock', { method: 'POST', body: JSON.stringify({ value: String(row.user_id) }) });
      loadBlockList();
    });
    body.appendChild(tr);
  });
}

function initBlockList() {
  $('#blockAddBtn').addEventListener('click', async () => {
    const input = $('#blockInput');
    const value = input.value.trim();
    if (!value) return;
    const btn = $('#blockAddBtn');
    btn.disabled = true;
    try {
      await api('/api/block', { method: 'POST', body: JSON.stringify({ value }) });
      input.value = '';
      loadBlockList();
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------------- mute list ----------------

async function loadMuteList() {
  const { data } = await api('/api/mutelist');
  const body = $('#muteTableBody');
  body.innerHTML = '';
  $('#muteEmpty').hidden = data.length > 0;
  data.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(row.name || '—')}</td>
      <td class="mono">${row.username ? '@' + escapeHtml(row.username) : '—'}</td>
      <td class="mono">${row.user_id}</td>
      <td class="mono">${escapeHtml(row.created_at || '')}</td>
      <td><button class="link-action" data-id="${row.user_id}">رفع سکوت</button></td>
    `;
    tr.querySelector('.link-action').addEventListener('click', async (e) => {
      e.target.disabled = true;
      await api('/api/unmute', { method: 'POST', body: JSON.stringify({ user_id: row.user_id }) });
      loadMuteList();
    });
    body.appendChild(tr);
  });
}

function initMuteList() {
  $('#muteAddBtn').addEventListener('click', async () => {
    const input = $('#muteInput');
    const value = input.value.trim();
    if (!value) return;
    const btn = $('#muteAddBtn');
    btn.disabled = true;
    try {
      await api('/api/mute', { method: 'POST', body: JSON.stringify({ value }) });
      input.value = '';
      loadMuteList();
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------------- chats ----------------

async function loadChats() {
  const { data } = await api('/api/chats');
  const body = $('#chatsTableBody');
  body.innerHTML = '';
  data.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(row.name || '—')}</td>
      <td class="mono">${row.username ? '@' + escapeHtml(row.username) : '—'}</td>
      <td class="mono">${row.received}</td>
      <td class="mono">${row.replies}</td>
      <td>${escapeHtml((row.last_message || '').slice(0, 60))}</td>
      <td class="mono">${escapeHtml(row.last_seen || '')}</td>
    `;
    body.appendChild(tr);
  });
}

// ---------------- deleted archive ----------------

let deletedPage = 1;

async function loadDeleted(page) {
  const { data, total, page_size } = await api(`/api/deleted?page=${page}`);
  deletedPage = page;
  const list = $('#deletedList');
  list.innerHTML = '';

  if (data.length === 0) {
    list.innerHTML = '<div class="deleted-item"><p class="hint">چیزی برای نمایش نیست.</p></div>';
  }

  data.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'deleted-item';
    const mediaBadge = item.has_media
      ? `<a class="deleted-media" href="/media/deleted/${item.id}" target="_blank" rel="noopener">${escapeHtml(item.media_type || 'رسانه')}</a>`
      : '';
    div.innerHTML = `
      <div class="deleted-meta">
        <span>${escapeHtml(item.name || 'نامشخص')} ${item.username ? '@' + escapeHtml(item.username) : ''}</span>
        <span class="mono">${formatTs(item.created_at)}</span>
      </div>
      <div class="deleted-text">${escapeHtml(item.text || '(بدون متن)')}</div>
      ${mediaBadge}
    `;
    list.appendChild(div);
  });

  const totalPages = Math.max(1, Math.ceil(total / page_size));
  $('#deletedPageInfo').textContent = `${page} / ${totalPages}`;
  $('#deletedPrev').disabled = page <= 1;
  $('#deletedNext').disabled = page >= totalPages;
}

function initDeleted() {
  $('#deletedPrev').addEventListener('click', () => loadDeleted(Math.max(1, deletedPage - 1)));
  $('#deletedNext').addEventListener('click', () => loadDeleted(deletedPage + 1));
}

function formatTs(unixSeconds) {
  if (!unixSeconds) return '';
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleString('fa-IR');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------------- logout ----------------

function initLogout() {
  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });
}

// ---------------- boot ----------------

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initAutoReply();
  initClock();
  initBlockList();
  initMuteList();
  initDeleted();
  initLogout();
  loadOverview();

  // keep the live clock-preview + brand dot feeling "alive"
  setInterval(() => {
    if ($('.panel[data-panel="clock"]').classList.contains('active')) {
      updateNamePreview();
      updateBioPreview();
    }
  }, 1000);
});
