const $ = (id) => document.getElementById(id);

const el = {
  pillSmtp: $('pill-smtp'),
  pillAi: $('pill-ai'),
  testSmtp: $('btn-test-smtp'),
  recipients: $('recipients'),
  recipientFile: $('recipient-file'),
  clearRecipients: $('btn-clear-recipients'),
  recipientCounter: $('recipient-counter'),
  recipientWarnings: $('recipient-warnings'),
  role: $('role'),
  roleList: $('role-suggestions'),
  deadline: $('deadline'),
  aiBox: $('ai-box'),
  aiState: $('ai-state'),
  aiInstructions: $('ai-instructions'),
  aiTone: $('ai-tone'),
  aiButton: $('btn-ai'),
  subject: $('subject'),
  body: $('body'),
  dropzone: $('dropzone'),
  attachments: $('attachments'),
  filelist: $('filelist'),
  fileCounter: $('file-counter'),
  preview: $('preview'),
  testAddress: $('test-address'),
  testSend: $('btn-test-send'),
  send: $('btn-send'),
  sendCount: $('send-count'),
  progressCard: $('progress-card'),
  cancel: $('btn-cancel'),
  csv: $('btn-csv'),
  barFill: $('bar-fill'),
  statSent: $('stat-sent'),
  statFailed: $('stat-failed'),
  statTotal: $('stat-total'),
  log: $('log'),
  toasts: $('toasts'),
};

let attachedFiles = [];
let validCount = 0;
let activeJobId = null;
let eventSource = null;

/* ------------------------------------------------------------ plumbing -- */

function toast(message, kind = '') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  el.toasts.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .3s';
    setTimeout(() => node.remove(), 300);
  }, 5200);
}

function authHeaders() {
  const key = sessionStorage.getItem('dashboardPassword');
  return key ? { 'x-dashboard-password': key } : {};
}

async function api(url, { json, form, method = 'POST' } = {}) {
  const options = { method, headers: { ...authHeaders() } };
  if (json) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(json);
  } else if (form) {
    options.body = form;
  }
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

const debounce = (fn, ms) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

const formatBytes = (bytes) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

/* -------------------------------------------------------------- startup -- */

async function boot() {
  let config;
  try {
    config = await api('/api/config', { method: 'GET' });
  } catch {
    toast('Cannot reach the server.', 'err');
    return;
  }

  if (config.passwordRequired && !sessionStorage.getItem('dashboardPassword')) {
    const entered = prompt('Dashboard password:');
    if (entered) sessionStorage.setItem('dashboardPassword', entered);
  }

  el.pillSmtp.textContent = config.smtpConfigured
    ? `SMTP ready · ${config.fromEmail}`
    : 'SMTP not configured';
  el.pillSmtp.className = `pill ${config.smtpConfigured ? 'ok' : 'off'}`;

  const providerLabel = { openai: 'OpenAI', anthropic: 'Claude' }[config.aiProvider] || '';
  el.pillAi.textContent = config.aiConfigured
    ? `AI ready · ${providerLabel} ${config.aiModel}`
    : 'AI off';
  el.pillAi.className = `pill ${config.aiConfigured ? 'ok' : ''}`;

  if (config.aiConfigured) {
    el.aiState.textContent = `via ${providerLabel}`;
  } else {
    el.aiBox.classList.add('disabled');
    el.aiState.textContent = 'add OPENAI_API_KEY to enable';
  }
  if (!config.smtpConfigured) {
    toast('Set SMTP_HOST, SMTP_USER and SMTP_PASS in .env, then restart the server.', 'err');
  }
}

/* ----------------------------------------------------------- recipients -- */

const refreshPreview = debounce(async () => {
  const raw = el.recipients.value;
  if (!raw.trim()) {
    validCount = 0;
    el.recipientCounter.textContent = '0 valid';
    el.recipientWarnings.hidden = true;
    el.preview.innerHTML = '<p class="muted">Add recipients and a message to see the preview.</p>';
    syncSendButton();
    return;
  }

  try {
    const data = await api('/api/preview', {
      json: {
        recipients: raw,
        subject: el.subject.value,
        body: el.body.value,
        deadline: el.deadline.value,
        role: el.role.value,
      },
    });

    validCount = data.counts.valid;
    const bits = [`${data.counts.valid} valid`];
    if (data.counts.duplicates) bits.push(`${data.counts.duplicates} duplicate`);
    if (data.counts.invalid) bits.push(`${data.counts.invalid} unreadable`);
    el.recipientCounter.textContent = bits.join(' · ');

    if (data.invalid.length) {
      el.recipientWarnings.hidden = false;
      el.recipientWarnings.textContent = `Skipped (not valid addresses): ${data.invalid.join(', ')}`;
    } else {
      el.recipientWarnings.hidden = true;
    }

    renderPreview(data.preview);
    syncSendButton();
  } catch (error) {
    toast(error.message, 'err');
  }
}, 300);

function renderPreview(preview) {
  if (!preview) {
    el.preview.innerHTML = '<p class="muted">Add recipients and a message to see the preview.</p>';
    return;
  }
  const attachNote = attachedFiles.length
    ? `<div class="pv-attach">📎 ${attachedFiles.map((f) => f.name).join(', ')}</div>`
    : '';
  el.preview.innerHTML = `
    <div class="pv-line"><span class="pv-label">To</span><span class="pv-value"></span></div>
    <div class="pv-line"><span class="pv-label">Subject</span><span class="pv-value pv-subject"></span></div>
    <div class="pv-body"></div>${attachNote}`;
  el.preview.querySelector('.pv-value').textContent = preview.to;
  el.preview.querySelector('.pv-subject').textContent = preview.subject || '(no subject)';
  el.preview.querySelector('.pv-body').textContent = preview.body || '(empty message)';
}

function syncSendButton() {
  const ready = validCount > 0 && el.subject.value.trim() && el.body.value.trim();
  el.send.disabled = !ready || Boolean(activeJobId);
  el.sendCount.textContent = validCount;
}

el.recipients.addEventListener('input', refreshPreview);
el.subject.addEventListener('input', refreshPreview);
el.body.addEventListener('input', refreshPreview);
el.deadline.addEventListener('input', refreshPreview);
el.role.addEventListener('input', refreshPreview);

el.clearRecipients.addEventListener('click', () => {
  el.recipients.value = '';
  refreshPreview();
});

el.recipientFile.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  el.recipients.value = el.recipients.value.trim()
    ? `${el.recipients.value.trim()}\n${text}`
    : text;
  event.target.value = '';
  refreshPreview();
  toast(`Imported ${file.name}.`, 'ok');
});

/* ---------------------------------------------------------- attachments -- */

function renderFiles() {
  el.filelist.innerHTML = '';
  attachedFiles.forEach((file, index) => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'fname';
    name.textContent = file.name;
    const size = document.createElement('span');
    size.className = 'fsize';
    size.textContent = formatBytes(file.size);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.addEventListener('click', () => {
      attachedFiles.splice(index, 1);
      renderFiles();
      refreshPreview();
    });
    item.append(name, size, remove);
    el.filelist.append(item);
  });
  el.fileCounter.textContent = attachedFiles.length
    ? `${attachedFiles.length} file${attachedFiles.length > 1 ? 's' : ''}`
    : 'none';
}

function addFiles(list) {
  for (const file of list) {
    if (attachedFiles.length >= 5) {
      toast('Maximum of 5 attachments.', 'err');
      break;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast(`${file.name} is bigger than 25 MB.`, 'err');
      continue;
    }
    if (!attachedFiles.some((f) => f.name === file.name && f.size === file.size)) {
      attachedFiles.push(file);
    }
  }
  renderFiles();
  refreshPreview();
}

el.attachments.addEventListener('change', (event) => {
  addFiles(event.target.files);
  event.target.value = '';
});

['dragenter', 'dragover'].forEach((type) =>
  el.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    el.dropzone.classList.add('over');
  }),
);
['dragleave', 'drop'].forEach((type) =>
  el.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    el.dropzone.classList.remove('over');
  }),
);
el.dropzone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));

/* ------------------------------------------------------------------ AI -- */

el.aiButton.addEventListener('click', async () => {
  const instructions = el.aiInstructions.value.trim();
  if (!instructions) {
    toast('Tell the AI what the email should say.', 'err');
    return;
  }
  el.aiButton.disabled = true;
  el.aiState.textContent = 'thinking…';
  try {
    const draft = await api('/api/ai/draft', {
      json: {
        instructions,
        deadline: el.deadline.value,
        tone: el.aiTone.value,
        hasAttachment: attachedFiles.length > 0,
        existingBody: el.body.value,
      },
    });
    el.subject.value = draft.subject;
    el.body.value = draft.body;
    el.aiState.textContent = 'drafted — edit as you like';
    refreshPreview();
  } catch (error) {
    el.aiState.textContent = '';
    toast(error.message, 'err');
  } finally {
    el.aiButton.disabled = false;
  }
});

/* --------------------------------------------------------- test actions -- */

el.testSmtp.addEventListener('click', async () => {
  el.testSmtp.disabled = true;
  try {
    const result = await api('/api/smtp/test');
    toast(result.message, 'ok');
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    el.testSmtp.disabled = false;
  }
});

el.testSend.addEventListener('click', async () => {
  const to = el.testAddress.value.trim();
  if (!to) {
    toast('Enter an address to send the test to.', 'err');
    return;
  }
  el.testSend.disabled = true;
  try {
    const form = new FormData();
    form.append('to', to);
    form.append('subject', el.subject.value);
    form.append('body', el.body.value);
    form.append('deadline', el.deadline.value);
    form.append('role', el.role.value);
    attachedFiles.forEach((file) => form.append('attachments', file));
    const result = await api('/api/send/test', { form });
    toast(result.message, 'ok');
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    el.testSend.disabled = false;
  }
});

/* ----------------------------------------------------------- the send -- */

el.send.addEventListener('click', async () => {
  const confirmed = confirm(
    `Send this email to ${validCount} recipient${validCount > 1 ? 's' : ''}?\n\n` +
      `Domain/Role: ${el.role.value.trim() || '(none)'}\n` +
      `Subject: ${el.subject.value}\n` +
      `Attachments: ${attachedFiles.length ? attachedFiles.map((f) => f.name).join(', ') : 'none'}`,
  );
  if (!confirmed) return;

  el.send.disabled = true;
  try {
    const form = new FormData();
    form.append('recipients', el.recipients.value);
    form.append('subject', el.subject.value);
    form.append('body', el.body.value);
    form.append('deadline', el.deadline.value);
    form.append('role', el.role.value);
    attachedFiles.forEach((file) => form.append('attachments', file));

    const { jobId, total } = await api('/api/send', { form });
    startTracking(jobId, total);
  } catch (error) {
    toast(error.message, 'err');
    syncSendButton();
  }
});

function startTracking(jobId, total) {
  activeJobId = jobId;
  el.progressCard.hidden = false;
  el.log.innerHTML = '';
  el.statTotal.textContent = total;
  el.statSent.textContent = '0';
  el.statFailed.textContent = '0';
  el.barFill.style.width = '0%';
  el.cancel.disabled = false;
  el.csv.href = `/api/jobs/${jobId}/results.csv`;
  el.progressCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const key = sessionStorage.getItem('dashboardPassword');
  const url = `/api/jobs/${jobId}/stream${key ? `?key=${encodeURIComponent(key)}` : ''}`;
  eventSource?.close();
  eventSource = new EventSource(url);

  eventSource.onmessage = (message) => {
    const event = JSON.parse(message.data);
    if (event.job) applyJobState(event.job);
    if (event.type === 'progress' && event.result) appendLog(event.result);
    if (event.type === 'error') toast(event.message, 'err');
    if (event.type === 'done' || event.type === 'error') finishTracking(event.job);
  };
  eventSource.onerror = () => {
    // The stream closes on its own once the job is finished — that is not a fault.
    if (!activeJobId) eventSource?.close();
  };
}

function applyJobState(job) {
  el.statSent.textContent = job.sent;
  el.statFailed.textContent = job.failed;
  el.statTotal.textContent = job.total;
  const done = job.sent + job.failed;
  el.barFill.style.width = `${job.total ? (done / job.total) * 100 : 0}%`;
}

function appendLog(result) {
  const item = document.createElement('li');
  const mark = document.createElement('span');
  mark.className = `mark ${result.status === 'sent' ? 'ok' : 'no'}`;
  mark.textContent = result.status === 'sent' ? '✓' : '✕';
  const addr = document.createElement('span');
  addr.className = 'addr';
  addr.textContent = result.email;
  item.append(mark, addr);
  if (result.error) {
    const why = document.createElement('span');
    why.className = 'why';
    why.textContent = result.error;
    item.append(why);
  }
  el.log.prepend(item);
}

function finishTracking(job) {
  activeJobId = null;
  eventSource?.close();
  eventSource = null;
  el.cancel.disabled = true;
  syncSendButton();
  if (!hist.view.hidden) loadHistory(); // keep the open history tab current
  if (!job) return;
  if (job.failed === 0) {
    toast(`Done — all ${job.sent} emails sent.`, 'ok');
  } else {
    toast(`Finished: ${job.sent} sent, ${job.failed} failed. Download the CSV for details.`, 'err');
  }
}

el.cancel.addEventListener('click', async () => {
  if (!activeJobId) return;
  try {
    await api(`/api/jobs/${activeJobId}/cancel`);
    toast('Stopping after the emails already in flight.', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
});

window.addEventListener('beforeunload', (event) => {
  if (activeJobId) event.preventDefault();
});

/* --------------------------------------------------------------- history -- */

const hist = {
  view: $('view-history'),
  compose: $('view-compose'),
  q: $('history-q'),
  status: $('history-status'),
  role: $('history-role'),
  domain: $('history-domain'),
  roleBody: document.querySelector('#role-table tbody'),
  source: $('history-source'),
  from: $('history-from'),
  to: $('history-to'),
  reset: $('history-reset'),
  stats: $('history-stats'),
  count: $('history-count'),
  domainBody: document.querySelector('#domain-table tbody'),
  rowsBody: document.querySelector('#history-table tbody'),
  pager: $('history-pager'),
  pageLabel: $('page-label'),
  prev: $('page-prev'),
  next: $('page-next'),
  exportLink: $('history-export'),
};

let historyPage = 1;

/** Refills a <select> while preserving the current choice. */
function fillOptions(select, values) {
  const keep = select.value;
  const placeholder = select.options[0];
  select.innerHTML = '';
  select.append(placeholder);
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  select.value = values.includes(keep) ? keep : '';
}

/** Renders one breakdown table; clicking a row toggles that value as a filter. */
function renderGroup(tbody, groups, select) {
  tbody.innerHTML = '';
  if (!groups.length) {
    tbody.innerHTML = '<tr><td class="empty" colspan="4">Nothing yet</td></tr>';
    return;
  }
  for (const g of groups) {
    const tr = document.createElement('tr');
    tr.className = `clickable${select.value === g.key ? ' is-filtered' : ''}`;
    tr.title = `Show only ${g.key}`;
    for (const [value, cls] of [[g.key, 'wrap'], [g.recipients, 'num'], [g.sent, 'num'], [g.failed, 'num']]) {
      const td = document.createElement('td');
      td.className = cls;
      td.textContent = value;
      tr.append(td);
    }
    tr.addEventListener('click', () => {
      select.value = select.value === g.key ? '' : g.key;
      historyPage = 1;
      loadHistory();
    });
    tbody.append(tr);
  }
}

function historyQuery(extra = {}) {
  return new URLSearchParams({
    q: hist.q.value.trim(),
    status: hist.status.value,
    role: hist.role.value,
    emailDomain: hist.domain.value,
    source: hist.source.value,
    from: hist.from.value,
    to: hist.to.value,
    page: String(historyPage),
    ...extra,
  });
}

const fmtWhen = (iso) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) +
        ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

async function loadHistory() {
  let data;
  try {
    data = await api(`/api/history?${historyQuery()}`, { method: 'GET' });
  } catch (error) {
    toast(error.message, 'err');
    return;
  }

  // Summary tiles
  const { sent = 0, failed = 0, uniqueRecipients = 0, uniqueRoles = 0 } = data.stats ?? {};
  const tiles = hist.stats.querySelectorAll('span');
  [sent, failed, uniqueRecipients, uniqueRoles].forEach((v, i) => {
    tiles[i].textContent = v;
  });

  // Filter options + compose autocomplete, refreshed from the full set
  fillOptions(hist.role, data.availableRoles ?? []);
  fillOptions(hist.domain, data.availableEmailDomains ?? []);
  el.roleList.innerHTML = '';
  for (const role of data.availableRoles ?? []) {
    const option = document.createElement('option');
    option.value = role;
    el.roleList.append(option);
  }

  // The two breakdowns: hiring domain first, email provider second
  renderGroup(hist.roleBody, data.roles ?? [], hist.role);
  renderGroup(hist.domainBody, data.emailDomains ?? [], hist.domain);

  // Recipient rows
  hist.rowsBody.innerHTML = '';
  if (!data.rows?.length) {
    hist.rowsBody.innerHTML =
      '<tr><td class="empty" colspan="5">No emails match these filters</td></tr>';
  }
  for (const r of data.rows ?? []) {
    const tr = document.createElement('tr');

    const when = document.createElement('td');
    when.className = 'when';
    when.textContent = fmtWhen(r.at);
    when.title = new Date(r.at).toLocaleString();

    const which = document.createElement('td');
    which.className = 'wrap';
    which.textContent = r.role && r.role !== '(none)' ? r.role : '—';

    const who = document.createElement('td');
    who.className = 'wrap';
    who.textContent = r.email;
    if (r.name) who.title = r.name;

    const what = document.createElement('td');
    what.className = 'wrap';
    what.textContent = r.subject || '—';
    if (r.attachments?.length) what.title = `📎 ${r.attachments.join(', ')}`;

    const state = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = `tag ${r.status}`;
    tag.textContent = r.status === 'sent' ? 'Delivered' : 'Failed';
    state.append(tag);
    if (r.source === 'test') {
      const test = document.createElement('span');
      test.className = 'tag test';
      test.textContent = 'test';
      state.append(test);
    }
    if (r.error) {
      const why = document.createElement('span');
      why.className = 'why-inline';
      why.textContent = r.error;
      state.append(why);
    }

    tr.append(when, which, who, what, state);
    hist.rowsBody.append(tr);
  }

  hist.count.textContent = `${data.total} result${data.total === 1 ? '' : 's'}`;
  hist.pager.hidden = data.pages <= 1;
  hist.pageLabel.textContent = `Page ${data.page} of ${data.pages}`;
  hist.prev.disabled = data.page <= 1;
  hist.next.disabled = data.page >= data.pages;
  historyPage = data.page;
  hist.exportLink.href = `/api/history/export.csv?${historyQuery()}`;
}

const reloadHistory = debounce(() => {
  historyPage = 1;
  loadHistory();
}, 250);

hist.q.addEventListener('input', reloadHistory);
[hist.status, hist.role, hist.domain, hist.source, hist.from, hist.to].forEach((control) =>
  control.addEventListener('change', reloadHistory),
);
hist.reset.addEventListener('click', () => {
  hist.q.value = '';
  hist.status.value = 'all';
  hist.role.value = '';
  hist.domain.value = '';
  hist.source.value = 'all';
  hist.from.value = '';
  hist.to.value = '';
  reloadHistory();
});
hist.prev.addEventListener('click', () => {
  historyPage -= 1;
  loadHistory();
});
hist.next.addEventListener('click', () => {
  historyPage += 1;
  loadHistory();
});

/**
 * Two real pages backed by the URL hash, so #history is bookmarkable and the
 * browser's back button moves between them.
 */
function showView(name) {
  const isHistory = name === 'history';
  hist.view.hidden = !isHistory;
  hist.compose.hidden = isHistory;
  document
    .querySelectorAll('.tab')
    .forEach((t) => t.classList.toggle('is-active', (t.dataset.view === 'history') === isHistory));
  document.title = isHistory ? 'History · Briefcase' : 'Briefcase';
  window.scrollTo(0, 0);
  if (isHistory) loadHistory();
}

const viewFromHash = () => (location.hash.replace('#', '') === 'history' ? 'history' : 'compose');

document.querySelectorAll('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    // Setting the hash fires hashchange, which does the actual switching.
    const target = tab.dataset.view === 'history' ? '#history' : '#compose';
    if (location.hash === target) showView(tab.dataset.view);
    else location.hash = target;
  }),
);

window.addEventListener('hashchange', () => showView(viewFromHash()));
showView(viewFromHash());

renderFiles();
syncSendButton();
boot();
