const el = (id) => document.getElementById(id);
const h = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};
const SEV = { high: '高', mid: '中', low: '低' };
const rank = (sev) => (sev === 'high' ? 3 : sev === 'mid' ? 2 : 1);
const FACTS = [
  ['monthlyRent', '月租金（元）'],
  ['deposit', '押金（元）'],
  ['depositMonths', '押金折合月数'],
  ['prepaidMonths', '单次预付租金（月）'],
  ['leaseYears', '约定租期（年）'],
  ['penaltyDailyRate', '逾期违约金日费率'],
  ['penaltyDailyAmount', '逾期每日金额（元）'],
  ['landlordDailyAmount', '房东逾期每日赔付（元）'],
  ['elecPrice', '电费单价（元/度）'],
  ['elecMarkupRatio', '电费相对目录价倍数']
];
const state = { result: null, filter: 'all' };

async function loadHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    const box = el('health');
    box.innerHTML = '';
    box.appendChild(h('div', '', (data.deps.pdfjs ? 'PDF ✓' : 'PDF ✗') + ' ｜ ' + (data.deps.jszip ? 'DOCX ✓' : 'DOCX ✗') + ' ｜ ' + (data.deps.tesseract ? 'OCR 适配器 ✓' : 'OCR ✗')));
    box.appendChild(h('div', '', '知识库 ' + data.kb.size + ' 条 ｜ 大模型：' + (data.llm.enabled ? data.llm.model : '未启用（离线规则引擎）')));
  } catch (error) {
    el('health').textContent = '服务未就绪：' + error.message;
  }
}

function setBusy(busy, label) {
  el('run').disabled = busy;
  el('run').textContent = busy ? '审查中…' : '开始审查';
  if (!busy) return;
  const list = el('pipeline');
  list.innerHTML = '';
  const busyItem = h('li', 'doing');
  busyItem.appendChild(h('span', '', label || '上传中…'));
  list.appendChild(busyItem);
}

function renderPipeline(result) {
  const list = el('pipeline');
  list.innerHTML = '';
  result.stages.forEach((stage) => {
    const li = h('li', 'done');
    li.appendChild(h('span', '', stage.name));
    li.appendChild(h('span', 'who', stage.owner));
    li.appendChild(h('span', 'ms', stage.ms + 'ms'));
    list.appendChild(li);
  });
  result.notices.forEach((note) => {
    const li = h('li', 'note');
    li.appendChild(h('span', '', note));
    list.appendChild(li);
  });
}

function renderSummary(result) {
  const box = el('summary');
  box.innerHTML = '';
  const grade = h('div', 'grade', result.grade.level);
  grade.style.background = result.grade.color + '1a';
  grade.style.color = result.grade.color;
  box.appendChild(grade);
  const text = h('div', 'summary-text');
  text.appendChild(h('h2', '', result.grade.label));
  const high = result.findings.filter((f) => f.severity === 'high').length;
  const cites = result.findings.reduce((n, f) => n + f.citations.length, 0);
  text.appendChild(h('p', '', result.findings.length
    ? '命中 ' + result.findings.length + ' 处风险条款（高风险 ' + high + ' 处），共引用法条 ' + cites + ' 次；' + result.stats.verified + ' 处通过原文与法条双校验。'
    : '未发现需要警示的条款。规则库与知识库均未命中，可作为「合同较为规范」的对照结果。'));
  const metrics = h('div', 'metrics');
  const metric = (label, value) => {
    const wrap = h('span', '', label + ' ');
    wrap.appendChild(h('b', '', value));
    return wrap;
  };
  metrics.appendChild(metric('风险分', result.score));
  metrics.appendChild(metric('条款数', result.document.clauses.length));
  metrics.appendChild(metric('字符数', result.document.chars));
  metrics.appendChild(metric('待复核法条', result.stats.pendingExpertReview.length));
  text.appendChild(metrics);
  box.appendChild(text);
  el('docmeta').textContent = '（' + result.document.filename + ' · ' + result.document.engine + ' · ' + result.document.pageCount + ' 页）';
}

function spansFor(clause, findings) {
  const picked = findings
    .filter((f) => f.start >= clause.start && f.start < clause.end)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  picked.forEach((f) => {
    const from = f.start;
    const to = Math.min(f.end, clause.end);
    const last = merged[merged.length - 1];
    if (last && from <= last.to) {
      last.to = Math.max(last.to, to);
      last.items.push(f);
    } else {
      merged.push({ from, to, items: [f] });
    }
  });
  return merged;
}

function renderDoc(result) {
  const box = el('doc');
  box.innerHTML = '';
  const text = result.document.text;
  result.document.clauses.forEach((clause) => {
    const card = h('div', 'clause');
    card.id = 'clause-' + clause.id;
    if (clause.heading) card.appendChild(h('h3', '', clause.heading));
    const firstLineEnd = text.indexOf('\n', clause.start);
    const displayStart = firstLineEnd > 0 && firstLineEnd < clause.end && text.slice(clause.start, firstLineEnd).trim() === clause.heading ? firstLineEnd + 1 : clause.start;
    const body = h('p');
    let cursor = displayStart;
    spansFor(clause, result.findings).forEach((span) => {
      const from = Math.max(span.from, displayStart);
      if (from > cursor) body.appendChild(document.createTextNode(text.slice(cursor, from)));
      const worst = span.items.slice().sort((a, b) => rank(b.severity) - rank(a.severity))[0];
      const mark = h('mark', worst.severity, text.slice(from, span.to));
      mark.dataset.finding = span.items.map((f) => f.id).join(',');
      mark.title = span.items.map((f) => f.name).join(' / ');
      mark.addEventListener('click', () => focusFinding(span.items[0].id));
      body.appendChild(mark);
      cursor = span.to;
    });
    if (cursor < clause.end) body.appendChild(document.createTextNode(text.slice(cursor, clause.end)));
    card.appendChild(body);
    box.appendChild(card);
  });
}

function renderFindings(result) {
  const panel = el('panel-findings');
  panel.innerHTML = '';
  result.notices.forEach((n) => panel.appendChild(h('div', 'notice', n)));
  const actions = h('div', 'actions');
  const exportLink = h('a', '', '导出避坑报告 (.md)');
  exportLink.href = '/api/report?id=' + encodeURIComponent(result.runId);
  actions.appendChild(exportLink);
  actions.appendChild(h('button', '', '打印 / 存 PDF')).addEventListener('click', () => window.print());
  panel.appendChild(actions);

  const filters = h('div', 'filters');
  [['all', '全部 ' + result.findings.length], ['high', '高'], ['mid', '中'], ['low', '低'], ['review', '待复核']].forEach((item) => {
    const btn = h('button', 'filter' + (state.filter === item[0] ? ' on' : ''), item[1]);
    btn.addEventListener('click', () => {
      state.filter = item[0];
      renderFindings(result);
    });
    filters.appendChild(btn);
  });
  panel.appendChild(filters);

  const list = result.findings.filter((f) => (state.filter === 'all' ? true : state.filter === 'review' ? f.status !== 'verified' : f.severity === state.filter));
  if (!list.length) panel.appendChild(h('p', 'empty', '该筛选条件下没有命中项。'));
  list.forEach((finding) => {
    const card = h('div', 'finding ' + finding.severity);
    card.id = 'finding-' + finding.id;
    const title = h('h3');
    title.appendChild(h('span', 'badge ' + finding.severity, SEV[finding.severity]));
    title.appendChild(h('span', '', finding.name));
    title.appendChild(h('span', 'where', finding.clauseHeading + ' · ' + finding.category));
    card.appendChild(title);
    card.appendChild(h('div', 'quote', '「' + finding.evidence + '」'));
    const dl = h('dl');
    const pair = (k, v) => {
      if (!v) return;
      dl.appendChild(h('dt', '', k));
      dl.appendChild(h('dd', '', v));
    };
    pair('这意味着', finding.plain);
    pair('为什么是坑', finding.why);
    pair('建议改法', finding.fix);
    card.appendChild(dl);
    if (finding.status !== 'verified') {
      const warn = h('div');
      warn.appendChild(h('span', 'badge warn', '待人工复核'));
      warn.appendChild(h('span', ' cites', ' 自动校验未能确认原文引用，不作为结论。'));
      card.appendChild(warn);
    }
    const cites = h('ul', 'cites');
    finding.citations.forEach((cite) => {
      const li = h('li');
      li.appendChild(h('div', '', cite.entry.source + ' ' + cite.entry.article + '（' + cite.entry.topic + '）'));
      li.appendChild(h('div', 'mono', cite.entry.text));
      const via = cite.via === 'rule' ? '规则绑定法条' : cite.via === 'bm25' ? 'BM25 检索命中（相关度 ' + cite.score + '）' : '模型引用';
      li.appendChild(h('div', 'via', via + (cite.entry.review === 'pending' ? ' · ⚠ 条号待法学专家复核' : '')));
      cites.appendChild(li);
    });
    card.appendChild(cites);
    card.addEventListener('click', () => focusClause(finding.clauseId));
    panel.appendChild(card);
  });
}

function focusFinding(id) {
  const card = el('finding-' + id);
  if (!card) return;
  document.querySelectorAll('mark.active').forEach((m) => m.classList.remove('active'));
  document.querySelectorAll('mark[data-finding]').forEach((m) => {
    if (m.dataset.finding.split(',').indexOf(id) >= 0) m.classList.add('active');
  });
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function focusClause(clauseId) {
  const node = el('clause-' + clauseId);
  if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderFacts(result) {
  const panel = el('panel-facts');
  panel.innerHTML = '';
  panel.appendChild(h('p', 'empty', '由「关键条款抽取」从合同正文解析出的结构化事实，用于触发量化校验（押金月数、预付周期、违约金费率、电费加价）。'));
  const table = h('table');
  const head = h('tr');
  head.appendChild(h('th', '', '项目'));
  head.appendChild(h('th', '', '识别结果'));
  table.appendChild(head);
  FACTS.forEach((item) => {
    const value = result.facts[item[0]];
    const row = h('tr');
    row.appendChild(h('td', '', item[1]));
    row.appendChild(h('td', '', value === null || value === undefined ? '未识别' : String(value)));
    table.appendChild(row);
  });
  panel.appendChild(table);
}

function mdToHtml(md) {
  const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const inline = (s) => escapeText(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/。(.{60,})/g, '。$1');
  const out = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  md.split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line) return closeList();
    if (line.indexOf('### ') === 0) { closeList(); out.push('<h3>' + inline(line.slice(4)) + '</h3>'); return; }
    if (line.indexOf('## ') === 0) { closeList(); out.push('<h2>' + inline(line.slice(3)) + '</h2>'); return; }
    if (line.indexOf('# ') === 0) { closeList(); out.push('<h1>' + inline(line.slice(2)) + '</h1>'); return; }
    if (line.indexOf('- ') === 0) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + inline(line.slice(2)) + '</li>');
      return;
    }
    if (line.indexOf('  - ') === 0) { out.push('<li class="mono">' + inline(line.slice(4)) + '</li>'); return; }
    if (line.indexOf('|') === 0) { closeList(); out.push('<p class="mono">' + inline(line) + '</p>'); return; }
    if (line === '---') { closeList(); out.push('<hr/>'); return; }
    closeList();
    out.push('<p>' + inline(line) + '</p>');
  });
  closeList();
  return out.join('');
}

function renderReport(result) {
  const panel = el('panel-report');
  panel.innerHTML = '';
  if (!result.findings.length) {
    panel.appendChild(h('p', 'empty', '未命中风险条款，报告以「关键条款抽取 + 完整性检查」为主。'));
  }
  const box = h('div', 'md');
  box.innerHTML = mdToHtml(result.report);
  panel.appendChild(box);
}

async function renderAudit() {
  const panel = el('panel-audit');
  panel.innerHTML = '<p class="empty">加载中…</p>';
  const res = await fetch('/api/audit');
  const data = await res.json();
  panel.innerHTML = '';
  panel.appendChild(h('p', 'empty', '每次审查落一条审计记录：解析引擎、命中数、通过校验数、待专家复核法条、是否脱敏。对应 Pod2「可信校验&隐私专员」。'));
  if (!data.records.length) { panel.appendChild(h('p', 'empty', '还没有审计记录。')); return; }
  const table = h('table');
  const head = h('tr');
  ['时间', '文件', '引擎', '命中', '通过', '待复核', '模型'].forEach((label) => head.appendChild(h('th', '', label)));
  table.appendChild(head);
  data.records.forEach((r) => {
    const row = h('tr');
    [(r.ts || '').slice(5, 16), r.filename, r.engine, r.findings, r.verified, r.needsReview + (r.pendingExpertReview && r.pendingExpertReview.length ? ' +专家' : ''), r.model]
      .forEach((v) => row.appendChild(h('td', '', String(v === undefined ? '' : v))));
    table.appendChild(row);
  });
  panel.appendChild(table);
}

async function renderKb() {
  const panel = el('panel-kb');
  panel.innerHTML = '<p class="empty">加载中…</p>';
  const kb = await fetch('/api/kb').then((r) => r.json());
  const prompt = await fetch('/api/prompt').then((r) => r.json());
  panel.innerHTML = '';
  panel.appendChild(h('p', 'empty', kb.meta.name + '（' + kb.entries.length + ' 条）· ' + kb.meta.disclaimer));
  const table = h('table');
  const head = h('tr');
  ['来源与条号', '主题', '复核状态'].forEach((label) => head.appendChild(h('th', '', label)));
  table.appendChild(head);
  kb.entries.forEach((entry) => {
    const row = h('tr');
    const cell = h('td');
    cell.appendChild(h('div', '', entry.source + ' ' + entry.article));
    cell.appendChild(h('div', 'mono', entry.text));
    row.appendChild(cell);
    row.appendChild(h('td', '', entry.topic));
    row.appendChild(h('td', '', entry.review === 'pending' ? '⚠ 待复核' : '已复核'));
    table.appendChild(row);
  });
  panel.appendChild(table);
  panel.appendChild(h('h3', '', '风险识别 Agent 提示词（设置 API Key 后即真实调用）'));
  panel.appendChild(h('pre', 'mono', prompt.system));
  panel.appendChild(h('p', 'empty', prompt.note));
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'panel-' + name));
  if (name === 'audit') renderAudit();
  if (name === 'kb') renderKb();
}

function render(result) {
  state.result = result;
  renderPipeline(result);
  renderSummary(result);
  renderDoc(result);
  renderFindings(result);
  renderFacts(result);
  renderReport(result);
  showTab('findings');
}

async function submit(payload) {
  setBusy(true, payload.file ? '上传并解析 ' + payload.file.name : '解析粘贴文本');
  try {
    let res;
    if (payload.file) {
      const form = new FormData();
      form.append('file', payload.file, payload.file.name);
      res = await fetch('/api/analyze', { method: 'POST', body: form });
    } else {
      res = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: payload.text, filename: 'pasted.txt' }) });
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '审查失败');
    render(data);
  } catch (error) {
    const list = el('pipeline');
    list.innerHTML = '';
    const fail = h('li', 'note');
    fail.appendChild(h('span', '', '失败：' + error.message));
    list.appendChild(fail);
  } finally {
    el('run').disabled = false;
    el('run').textContent = '开始审查';
  }
}

function bind() {
  const drop = el('drop');
  const input = el('file');
  drop.addEventListener('click', (e) => {
    if (e.target.tagName !== 'LABEL') input.click();
  });
  ['dragover', 'dragenter'].forEach((evt) => drop.addEventListener(evt, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((evt) => drop.addEventListener(evt, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) submit({ file });
  });
  input.addEventListener('change', () => {
    if (input.files[0]) submit({ file: input.files[0] });
  });
  el('run').addEventListener('click', () => {
    const text = el('paste').value.trim();
    if (text) submit({ text });
    else input.click();
  });
  el('reset').addEventListener('click', () => window.location.reload());
  document.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', async () => {
    const name = chip.dataset.sample;
    setBusy(true, '载入样例 ' + name);
    const res = await fetch('/api/sample?name=' + encodeURIComponent(name));
    const blob = await res.blob();
    submit({ file: new File([blob], name) });
  }));
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
}

bind();
loadHealth();
