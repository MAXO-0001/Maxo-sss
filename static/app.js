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

// ---------------- unicode "fancy font" engine (mirrors bot.py FONT_MAPS) ----------------

const FONT_MAPS = {
  1: { upper: 0x1D5D4, lower: 0x1D5EE, digit: 0x1D7EC },
  2: { upper: 0x1D400, lower: 0x1D41A, digit: 0x1D7CE },
  3: { upper: 0x1D670, lower: 0x1D68A, digit: 0x1D7F6 },
  4: { upper: 0x1D5A0, lower: 0x1D5BA, digit: 0x1D7E2 },
  5: { upper: 0x1D434, lower: 0x1D44E, digit: null, overrides: { h: '\u210E' } },
  6: { upper: 0x1D468, lower: 0x1D482, digit: 0x1D7CE },
  7: { upper: 0x1D608, lower: 0x1D622, digit: 0x1D7E2 },
  8: { upper: 0x1D63C, lower: 0x1D656, digit: 0x1D7EC },
  9: { upper: 0x1D4D0, lower: 0x1D4EA, digit: null },
  10: { upper: 0x1D56C, lower: 0x1D586, digit: null },
  11: {
    upper: 0x1D538, lower: 0x1D552, digit: null,
    overrides: { C: '\u2102', H: '\u210D', I: '\u2111', N: '\u2115', P: '\u2119', Q: '\u211A', R: '\u211D', Z: '\u2124' },
  },
};

const FONT_NAMES = {
  1: 'Sans Bold', 2: 'Bold', 3: 'Monospace', 4: 'Sans',
  5: 'Italic', 6: 'Bold Italic', 7: 'Sans Italic', 8: 'Sans Bold Italic',
  9: 'Bold Script', 10: 'Bold Fraktur', 11: 'Double-Struck',
};

function applyFont(text, font) {
  const map = FONT_MAPS[font] || FONT_MAPS[1];
  let out = '';
  for (const ch of text) {
    if (map.overrides && map.overrides[ch] !== undefined) { out += map.overrides[ch]; continue; }
    if (ch >= 'A' && ch <= 'Z') out += String.fromCodePoint(map.upper + (ch.charCodeAt(0) - 65));
    else if (ch >= 'a' && ch <= 'z') out += String.fromCodePoint(map.lower + (ch.charCodeAt(0) - 97));
    else if (ch >= '0' && ch <= '9' && map.digit !== null) out += String.fromCodePoint(map.digit + (ch.charCodeAt(0) - 48));
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

// ---------------- state ----------------

const state = {
  nameFont: 1,
  bioFont: 1,
};

// ---------------- boot sequence ----------------

function runBoot() {
  const lines = [
    'اتصال به سلف برقرار شد...',
    'احراز هویت پنل تایید شد.',
    'در حال بارگذاری وضعیت...',
    'MAXO آماده است.',
  ];
  const box = $('#bootLines');
  lines.forEach((text, i) => {
    setTimeout(() => {
      const div = document.createElement('div');
      div.className = 'boot-line';
      div.textContent = text;
      box.appendChild(div);
    }, i * 260);
  });
  setTimeout(() => {
    $('#bootOverlay').classList.add('hidden');
  }, lines.length * 260 + 350);
}

function initGlitch() {
  setInterval(() => {
    const mark = $('#brandMark');
    if (!mark) return;
    mark.classList.add('glitch');
    setTimeout(() => mark.classList.remove('glitch'), 220);
  }, 6000);
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

function loadPanel(name) {
  if (name === 'overview') return loadOverview();
  if (name === 'autoreply') return loadAutoReply();
  if (name === 'clock') return loadClock();
  if (name === 'block') return loadBlockList();
  if (name === 'mute') return loadMuteList();
  if (name === 'messages') return; // static form, nothing to preload
  if (name === 'chats') return loadChats();
  if (name === 'deleted') return loadDeleted(1);
}

// ---------------- count-up animation ----------------

function countUp(el, target) {
  const duration = 500;
  const start = performance.now();
  const from = 0;
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (target - from) * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = target;
  }
  requestAnimationFrame(step);
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
  const [{ data }, accRes] = await Promise.all([
    api('/api/stats'),
    api('/api/account').catch(() => ({ data: null })),
  ]);

  const grid = $('#statGrid');
  grid.innerHTML = '';
  STAT_LABELS.forEach(([key, label]) => {
    const cell = document.createElement('div');
    cell.className = 'stat-cell';
    const num = document.createElement('div');
    num.className = 'stat-num mono';
    num.textContent = '0';
    const lbl = document.createElement('div');
    lbl.className = 'stat-label';
    lbl.textContent = label;
    cell.appendChild(num);
    cell.appendChild(lbl);
    grid.appendChild(cell);
    countUp(num, data[key] ?? 0);
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

  if (accRes && accRes.data) {
    $('#accName').textContent = accRes.data.name || '—';
    $('#accUsername').textContent = accRes.data.username || '—';
    $('#accId').textContent = accRes.data.id ?? '—';
    $('#accPhone').textContent = accRes.data.phone || '—';
  }
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

// ---------------- fonts + name / bio clock ----------------

function renderFontGallery(containerId, sampleText, selected, onSelect) {
  const container = $(containerId);
  container.innerHTML = '';
  Object.keys(FONT_MAPS).forEach((idStr) => {
    const id = Number(idStr);
    const card = document.createElement('div');
    card.className = 'font-card' + (id === selected ? ' selected' : '');
    card.innerHTML = `
      <div class="font-card-sample">${applyFont(sampleText, id)}</div>
      <div class="font-card-name">${id}. ${FONT_NAMES[id]}</div>
    `;
    card.addEventListener('click', () => {
      $$('.font-card', container).forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      onSelect(id);
    });
    container.appendChild(card);
  });
}

async function loadClock() {
  const { data } = await api('/api/stats');
  state.nameFont = data.name_font || 1;
  state.bioFont = data.bio_font || 1;

  $('#nameClockToggle').checked = data.name_clock;
  $('#nameLabel').value = data.name_label || 'MAXO';
  $('#bioClockToggle').checked = data.bio_clock;

  refreshFontGalleries();
  updateNamePreview();
  updateBioPreview();
}

function refreshFontGalleries() {
  const label = $('#nameLabel').value || 'MAXO';
  renderFontGallery('#nameFontGallery', `${label} 12`, state.nameFont, (id) => {
    state.nameFont = id;
    updateNamePreview();
  });
  renderFontGallery('#bioFontGallery', 'TIME 12', state.bioFont, (id) => {
    state.bioFont = id;
    updateBioPreview();
  });
}

function updateNamePreview() {
  const label = $('#nameLabel').value || 'MAXO';
  $('#namePreview').textContent = applyFont(`${label} | ${clock12h()}`, state.nameFont);
}

function updateBioPreview() {
  $('#bioPreview').textContent = applyFont(`TIME : ${clock12h()}`, state.bioFont);
}

function initClock() {
  $('#nameLabel').addEventListener('input', () => {
    refreshFontGalleries();
    updateNamePreview();
  });

  $('#saveNameClock').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await api('/api/name-clock', {
        method: 'POST',
        body: JSON.stringify({
          enabled: $('#nameClockToggle').checked,
          font: state.nameFont,
          label: $('#nameLabel').value,
        }),
      });
    } finally {
      e.target.disabled = false;
    }
  });

  $('#saveBioClock').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await api('/api/bio-clock', {
        method: 'POST',
        body: JSON.stringify({
          enabled: $('#bioClockToggle').checked,
          font: state.bioFont,
        }),
      });
    } finally {
      e.target.disabled = false;
    }
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
      <td><button class="link-action">آنبلاک</button></td>
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
      <td><button class="link-action">رفع سکوت</button></td>
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

// ---------------- delete messages ----------------

function initDeleteMessages() {
  $('#delBtn').addEventListener('click', async () => {
    const value = $('#delValue').value.trim();
    const count = Number($('#delCount').value || 0);
    const result = $('#delResult');
    result.textContent = '';
    if (!value || count <= 0) {
      result.textContent = 'مخاطب و تعداد رو درست وارد کن.';
      return;
    }
    const btn = $('#delBtn');
    btn.disabled = true;
    result.textContent = 'در حال حذف...';
    try {
      const res = await api('/api/delete-messages', {
        method: 'POST',
        body: JSON.stringify({ value, count }),
      });
      result.textContent = `${res.deleted} پیام حذف شد.`;
    } catch (e) {
      result.textContent = 'حذف انجام نشد — مخاطب رو بررسی کن.';
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
  runBoot();
  initGlitch();
  initTabs();
  initAutoReply();
  initClock();
  initBlockList();
  initMuteList();
  initDeleteMessages();
  initDeleted();
  initLogout();
  loadOverview();

  setInterval(() => {
    if ($('.panel[data-panel="clock"]').classList.contains('active')) {
      updateNamePreview();
      updateBioPreview();
    }
  }, 1000);
});
