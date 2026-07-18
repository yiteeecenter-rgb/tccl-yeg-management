import { sb } from './supabase.js';

const BUCKET = 'monthly-reports';

let topics       = [];   // flat: {id, code, parent_id, title, sort_order, is_active}
let reports      = [];   // report headers (joined)
let itemsByReport = {};  // report_id -> [monthly_report_items]
let jobsCache    = [];
let filterJobId  = '';
let showInactiveTopics = false;

let currentReport = null;
let currentItems   = [];

const pdfPageThumbCache = {}; // file_url -> [{url, landscape}, ...] one flat image per PDF page
const imageOrientationCache = {}; // file_url -> boolean (true = landscape)
let previewToken = 0;

function probeImageOrientation(url) {
  if (imageOrientationCache[url] !== undefined) return Promise.resolve(imageOrientationCache[url]);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { const l = img.naturalWidth > img.naturalHeight; imageOrientationCache[url] = l; resolve(l); };
    img.onerror = () => { imageOrientationCache[url] = false; resolve(false); };
    img.src = url;
  });
}

// ── Helpers ───────────────────────────────────────────────────
function escH(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toast(msg, ms = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}
function fmtMonth(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'long' });
}
function mains()          { return topics.filter(t => !t.parent_id && (showInactiveTopics || t.is_active)).sort((a,b)=>a.sort_order-b.sort_order); }
function subsOf(mainId)   { return topics.filter(t => t.parent_id === mainId && (showInactiveTopics || t.is_active)).sort((a,b)=>a.sort_order-b.sort_order); }
function activeMains()    { return topics.filter(t => !t.parent_id && t.is_active).sort((a,b)=>a.sort_order-b.sort_order); }
function activeSubsOf(id) { return topics.filter(t => t.parent_id === id && t.is_active).sort((a,b)=>a.sort_order-b.sort_order); }

// leaf topics in document order — main items with no sub-items are leaves themselves
function leafTopicsInOrder() {
  const result = [];
  activeMains().forEach(m => {
    const subs = activeSubsOf(m.id);
    if (subs.length === 0) result.push(m);
    else subs.forEach(s => result.push(s));
  });
  return result;
}

// full document flow in order: a 'section' entry (with its own cover page)
// precedes the 'leaf' entries under it; main topics with no sub-items are
// leaves themselves and get no separate section cover.
function documentFlowInOrder() {
  const flow = [];
  activeMains().forEach(m => {
    const subs = activeSubsOf(m.id);
    if (subs.length === 0) {
      flow.push({ kind: 'leaf', topic: m });
    } else {
      flow.push({ kind: 'section', topic: m });
      subs.forEach(s => flow.push({ kind: 'leaf', topic: s }));
    }
  });
  return flow;
}

function progressOf(reportId) {
  const leaves = leafTopicsInOrder();
  const items = itemsByReport[reportId] || [];
  const done = leaves.filter(t => items.some(i => i.topic_id === t.id && i.file_url)).length;
  return { done, total: leaves.length };
}

async function computePageCount(file) {
  if (file.type === 'application/pdf') {
    try {
      const { PDFDocument } = await import('https://esm.sh/pdf-lib@1.17.1');
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes);
      return doc.getPageCount();
    } catch (e) { return 1; }
  }
  return 1;
}

// page 1 = cover, page 2 = table of contents, content starts at page 3.
// Each section (main topic with sub-items) gets its own 1-page section
// cover; its TOC row points at that cover page.
function computePageNumbers() {
  const map = {};
  let page = 3;
  documentFlowInOrder().forEach(entry => {
    if (entry.kind === 'section') {
      map[entry.topic.id] = page;
      page += 1;
      return;
    }
    const item = currentItems.find(i => i.topic_id === entry.topic.id && i.file_url);
    if (item) {
      map[entry.topic.id] = page;
      page += item.page_count || 1;
    } else {
      map[entry.topic.id] = null;
    }
  });
  return map;
}

// ── Supabase CRUD ─────────────────────────────────────────────
async function listTopics() {
  const { data, error } = await sb.from('monthly_report_topics').select('*').order('sort_order');
  if (error) throw error;
  return data || [];
}
async function listReports() {
  const { data, error } = await sb.from('monthly_reports')
    .select('*, jobs(job_name,job_code), companies(name), profiles!created_by(full_name)')
    .order('report_month', { ascending: false });
  if (error) throw error;
  return data || [];
}
async function listAllItems(reportIds) {
  if (!reportIds.length) return {};
  const { data, error } = await sb.from('monthly_report_items').select('*').in('report_id', reportIds);
  if (error) throw error;
  const map = {};
  (data || []).forEach(i => { (map[i.report_id] ??= []).push(i); });
  return map;
}
async function uploadItemFile(reportId, topicId, file) {
  const ext  = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `${reportId}/${topicId}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (error) throw new Error('อัพโหลดไฟล์ล้มเหลว: ' + error.message);
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  // cache-bust: re-uploading to the same topic reuses this exact path, so
  // without a unique query string, both our in-memory render cache and the
  // browser's own HTTP cache would keep serving the old file's content
  return data.publicUrl + '?v=' + Date.now();
}

// ── Init ──────────────────────────────────────────────────────
window._mrInit = async function () {
  const { data: { user } } = await sb.auth.getUser();
  window._mrCurrentUserId = user?.id || null;
  window._mrCurrentRole = 'staff';
  if (user?.id) {
    try {
      const { data: prof } = await sb.from('profiles').select('role').eq('id', user.id).single();
      window._mrCurrentRole = prof?.role || 'staff';
    } catch (e) { /* keep default */ }
  }

  try {
    const [t, r, jobs] = await Promise.all([
      listTopics(),
      listReports(),
      sb.from('jobs').select('*').eq('is_active', true).order('job_name'),
    ]);
    topics    = t;
    reports   = r;
    jobsCache = jobs.data || [];
    itemsByReport = await listAllItems(reports.map(r => r.id));
  } catch (e) {
    topics = []; reports = []; jobsCache = []; itemsByReport = {};
  }
  renderTab();
};

// ── Tab (report list) ────────────────────────────────────────
function renderTab() {
  const pane = document.getElementById('tab-monthly-report');
  if (!pane) return;

  const list = filterJobId ? reports.filter(r => r.job_id === filterJobId) : reports;
  const canManage = ['admin','manager','owner'].includes(window._mrCurrentRole);

  const rows = list.length
    ? list.map(r => {
        const p = progressOf(r.id);
        return `
        <tr>
          <td><strong>${escH(r.jobs?.job_name || '—')}</strong><br><span style="font-size:11px;color:#94a3b8">${escH(r.jobs?.job_code || '')}</span></td>
          <td>${fmtMonth(r.report_month)}</td>
          <td>${escH(r.project_name || '—')}</td>
          <td>
            <span class="badge ${p.done===p.total && p.total>0 ? 'badge-approved':'badge-pending'}">${p.done}/${p.total} หัวข้อ</span>
          </td>
          <td>${r.merged_pdf_url ? `<button class="btn btn-sm btn-outline" onclick="window.open('${escH(r.merged_pdf_url)}','_blank')">📄 ดู PDF</button>` : '<span style="color:#94a3b8;font-size:12px">ยังไม่สร้าง</span>'}</td>
          <td>${escH(r.profiles?.full_name || '—')}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-primary" onclick="window._mrOpenReport('${r.id}')">เปิด</button>
            ${canManage ? `<button class="btn btn-sm btn-danger" onclick="window._mrDeleteReport('${r.id}')">ลบ</button>` : ''}
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8">ยังไม่มีรายงาน — กดปุ่ม <strong>+ สร้างรายงาน</strong> เพื่อเริ่มต้น</td></tr>`;

  pane.innerHTML = `
  <div class="card">
    <div class="card-header">
      <h3>รายงานประจำเดือน</h3>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="form-control" style="height:36px;width:220px" onchange="window._mrFilterJob(this)">
          <option value="">ทุกสถานี/งาน</option>
          ${jobsCache.map(j => `<option value="${j.id}" ${filterJobId===j.id?'selected':''}>${escH(j.job_name)}</option>`).join('')}
        </select>
        ${canManage ? `<button class="btn btn-outline" style="color:#7c3aed;border-color:#7c3aed" onclick="window._mrOpenTopics()">⚙ จัดการหัวข้อ</button>` : ''}
        <button class="btn btn-primary" onclick="window._mrOpenNewModal()">+ สร้างรายงาน</button>
      </div>
    </div>
    <div class="card-body">
      <table>
        <thead><tr><th>สถานี / งาน</th><th>เดือน</th><th>โครงการ</th><th>ความคืบหน้า</th><th>ไฟล์รวม</th><th>ผู้บันทึก</th><th>จัดการ</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window._mrFilterJob = function (sel) { filterJobId = sel.value; renderTab(); };

// ── New report modal ─────────────────────────────────────────
function injectNewModal() {
  if (document.getElementById('modal-mr-new')) return;
  document.body.insertAdjacentHTML('beforeend', `
<div class="modal-overlay" id="modal-mr-new">
  <div class="modal-box" style="max-width:420px">
    <div class="modal-head">
      <h3>สร้างรายงานประจำเดือน</h3>
      <button class="modal-close" onclick="window._mrCloseNewModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>สถานี / งาน</label>
        <select class="form-control" id="mr-new-job"></select>
      </div>
      <div class="form-group">
        <label>เดือน / ปี</label>
        <input type="month" class="form-control" id="mr-new-month">
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-outline" onclick="window._mrCloseNewModal()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="window._mrCreateReport()">เปิดรายงาน</button>
    </div>
  </div>
</div>`);
}
window._mrOpenNewModal = function () {
  injectNewModal();
  const sel = document.getElementById('mr-new-job');
  sel.innerHTML = '<option value="">-- เลือกสถานี/งาน --</option>' +
    jobsCache.map(j => `<option value="${j.id}">${escH(j.job_name)} (${escH(j.job_code)})</option>`).join('');
  document.getElementById('mr-new-month').value = new Date().toISOString().slice(0,7);
  document.getElementById('modal-mr-new').classList.add('open');
};
window._mrCloseNewModal = function () {
  document.getElementById('modal-mr-new')?.classList.remove('open');
};

window._mrCreateReport = async function () {
  const jobId = document.getElementById('mr-new-job').value;
  const month = document.getElementById('mr-new-month').value;
  if (!jobId) return toast('กรุณาเลือกสถานี/งาน');
  if (!month) return toast('กรุณาเลือกเดือน/ปี');
  const reportMonth = month + '-01';

  let rec = reports.find(r => r.job_id === jobId && (r.report_month || '').slice(0,7) === month);
  if (!rec) {
    const job = jobsCache.find(j => j.id === jobId);
    try {
      const { data, error } = await sb.from('monthly_reports').insert({
        job_id: jobId, company_id: job?.company_id || null, report_month: reportMonth,
        project_name: job?.job_name || '', created_by: window._mrCurrentUserId,
      }).select('*, jobs(job_name,job_code), companies(name), profiles!created_by(full_name)').single();
      if (error) throw error;
      rec = data;
      reports.unshift(rec);
      itemsByReport[rec.id] = [];
    } catch (e) {
      const { data: existing } = await sb.from('monthly_reports')
        .select('*, jobs(job_name,job_code), companies(name), profiles!created_by(full_name)')
        .eq('job_id', jobId).eq('report_month', reportMonth).maybeSingle();
      if (existing) { rec = existing; itemsByReport[rec.id] ??= []; }
      else return toast('เกิดข้อผิดพลาด: ' + e.message);
    }
  }
  window._mrCloseNewModal();
  renderTab();
  window._mrOpenReport(rec.id);
};

window._mrDeleteReport = async function (id) {
  const ok = await window.appConfirm({ title: 'ลบรายงาน', message: 'ต้องการลบรายงานนี้ทั้งหมด (รวมไฟล์ที่แนบ) ใช่ไหม? ไม่สามารถกู้คืนได้', okText: 'ลบ', okColor: '#e53e3e' });
  if (!ok) return;
  try {
    const { error } = await sb.from('monthly_reports').delete().eq('id', id);
    if (error) throw error;
    reports = reports.filter(r => r.id !== id);
    delete itemsByReport[id];
    toast('ลบรายงานแล้ว');
    renderTab();
  } catch (e) { toast('เกิดข้อผิดพลาด: ' + e.message); }
};

// ── Report detail modal ──────────────────────────────────────
function injectDetailModal() {
  if (document.getElementById('modal-mr-detail')) return;
  document.body.insertAdjacentHTML('beforeend', `
<div class="modal-overlay" id="modal-mr-detail">
  <div class="modal-box" id="modal-mr-detail-box" style="max-width:1180px;width:95vw;display:flex;flex-direction:column;max-height:92vh">
    <div class="modal-head">
      <h3 id="mr-detail-title">รายงานประจำเดือน</h3>
      <button class="modal-close" onclick="window._mrCloseDetail()">✕</button>
    </div>
    <div style="display:flex;gap:0;flex:1;min-height:0;overflow:hidden">
      <div class="modal-body" style="flex:0 0 480px;width:480px;overflow-y:auto">
        <div class="form-row" style="margin-bottom:18px">
          <div class="form-group">
            <label>ชื่อโครงการ</label>
            <input class="form-control" id="mr-project-name" oninput="window._mrLiveInput()" onblur="window._mrSaveMeta()">
          </div>
          <div class="form-group">
            <label>เลขที่สัญญา (Contract No.)</label>
            <input class="form-control" id="mr-contract-no" oninput="window._mrLiveInput()" onblur="window._mrSaveMeta()">
          </div>
        </div>
        <div id="mr-topics-list"></div>
      </div>
      <div style="flex:1;min-width:0;border-left:1px solid #e2e8f0;overflow-y:auto;background:#f7f9fc;padding:20px">
        <div style="font-size:12px;color:#888;margin-bottom:10px">— ตัวอย่างเอกสาร (อัปเดตอัตโนมัติ) — หน้าปก + สารบัญ</div>
        <div id="mr-live-preview" style="max-width:420px;margin:0 auto"></div>
      </div>
    </div>
    <div class="modal-foot" style="justify-content:space-between">
      <div id="mr-merge-status" style="font-size:12px;color:#888"></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" onclick="window._mrCloseDetail()">ปิด</button>
        <button class="btn btn-success" id="mr-merge-btn" onclick="window._mrMerge()">📎 สร้างไฟล์ PDF รวม</button>
      </div>
    </div>
  </div>
</div>`);
}

window._mrLiveInput = function () {
  if (!currentReport) return;
  currentReport.project_name = document.getElementById('mr-project-name').value;
  currentReport.contract_no  = document.getElementById('mr-contract-no').value;
  renderLivePreview();
};

function leafRowHTML(topic) {
  const item = currentItems.find(i => i.topic_id === topic.id);
  const has  = !!item?.file_url;
  const isImg = (item?.file_type || '').startsWith('image/');
  return `
  <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:${has?'#f0fdf4':'#f7fafc'};margin-bottom:6px">
    <div style="width:44px;font-size:12px;color:#64748b;flex-shrink:0">${escH(topic.code)}</div>
    <div style="flex:1;font-size:13px;color:#334155">${escH(topic.title)}</div>
    ${has ? `
      ${isImg
        ? `<img src="${escH(item.file_url)}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;cursor:pointer;border:1.5px solid #e2e8f0" onclick="window._mrPreviewFile('${topic.id}')" title="ดูตัวอย่าง">`
        : `<div style="width:52px;height:52px;border-radius:8px;border:1.5px solid #e2e8f0;background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:20px" onclick="window._mrPreviewFile('${topic.id}')" title="ดูตัวอย่าง">📄</div>`}
      <button class="btn btn-sm btn-outline" onclick="window._mrPreviewFile('${topic.id}')">👁 ดูตัวอย่าง</button>
      <button class="btn-del-row" title="ลบไฟล์" onclick="window._mrItemRemove('${topic.id}')">✕</button>
    ` : `
      <label class="btn btn-sm btn-outline" style="cursor:pointer;margin:0">
        แนบไฟล์
        <input type="file" accept="image/png,image/jpeg,application/pdf" style="display:none" onchange="window._mrItemFileChange('${topic.id}',this)">
      </label>
    `}
  </div>`;
}

// ── File preview modal ──────────────────────────────────────
function injectPreviewModal() {
  if (document.getElementById('modal-mr-preview')) return;
  document.body.insertAdjacentHTML('beforeend', `
<div class="modal-overlay" id="modal-mr-preview">
  <div class="modal-box" style="max-width:900px;width:90vw;display:flex;flex-direction:column;max-height:92vh">
    <div class="modal-head">
      <h3 id="mr-preview-title">ตัวอย่างไฟล์</h3>
      <button class="modal-close" onclick="document.getElementById('modal-mr-preview').classList.remove('open')">✕</button>
    </div>
    <div class="modal-body" id="mr-preview-body" style="overflow:auto;flex:1;display:flex;align-items:center;justify-content:center;background:#f7f9fc;padding:16px"></div>
    <div class="modal-foot">
      <a class="btn btn-outline" id="mr-preview-newtab" href="#" target="_blank" rel="noopener">เปิดในแท็บใหม่</a>
      <button class="btn btn-primary" onclick="document.getElementById('modal-mr-preview').classList.remove('open')">ปิด</button>
    </div>
  </div>
</div>`);
}

window._mrPreviewFile = async function (topicId) {
  const item = currentItems.find(i => i.topic_id === topicId);
  if (!item?.file_url) return;
  const topic = topics.find(t => t.id === topicId);
  injectPreviewModal();
  document.getElementById('mr-preview-title').textContent = `${topic ? topic.code + ' ' + topic.title : 'ตัวอย่างไฟล์'}`;
  document.getElementById('mr-preview-newtab').href = item.file_url;
  const body = document.getElementById('mr-preview-body');
  if ((item.file_type || '').startsWith('image/')) {
    body.innerHTML = `<img src="${escH(item.file_url)}" style="max-width:100%;max-height:75vh;border-radius:8px;object-fit:contain">`;
    document.getElementById('modal-mr-preview').classList.add('open');
    return;
  }
  body.innerHTML = `<div style="color:#94a3b8;font-size:13px">กำลังโหลดตัวอย่าง...</div>`;
  document.getElementById('modal-mr-preview').classList.add('open');
  const pages = await renderPdfPagesToImages(item.file_url);
  if (!pages.length) {
    body.innerHTML = `<iframe src="${escH(item.file_url)}#toolbar=0&navpanes=0" style="width:100%;height:75vh;border:none;border-radius:8px;background:#fff"></iframe>`;
    return;
  }
  body.innerHTML = pages.map((p, i) => `
    <div style="text-align:center;font-size:11px;color:#aaa;margin:${i===0?'0':'12px'} 0 4px">${pages.length > 1 ? `หน้า ${i + 1}/${pages.length}` : ''}</div>
    <img src="${p.url}" style="max-width:100%;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.08);margin-bottom:8px">
  `).join('');
};

function renderDetailBody() {
  const el = document.getElementById('mr-topics-list');
  if (!el) return;
  showInactiveTopics = false;
  const html = mains().map(m => {
    const subs = subsOf(m.id);
    // main items with no sub-items (e.g. 9, 10, 11) are leaves themselves —
    // still wrapped in the same card style as sectioned items, for a
    // consistent look regardless of whether a topic has sub-items or not
    const rows = subs.length ? subs : [m];
    const done = rows.filter(s => currentItems.some(i => i.topic_id === s.id && i.file_url)).length;
    return `
      <div style="margin-bottom:14px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <div style="background:#f7fafc;padding:10px 14px;font-size:13.5px;font-weight:700;color:#1a3c5e;display:flex;justify-content:space-between;align-items:center">
          <span>${escH(m.code)}  ${escH(m.title)}</span>
          <span class="badge ${done===rows.length?'badge-approved':'badge-pending'}">${done}/${rows.length}</span>
        </div>
        <div style="padding:10px 14px">
          ${subs.length ? subs.map(s => leafRowHTML(s)).join('') : leafRowHTML(m)}
        </div>
      </div>`;
  }).join('');
  el.innerHTML = html || '<div style="color:#94a3b8;text-align:center;padding:20px">ยังไม่มีหัวข้อรายงาน — ให้ผู้ดูแลระบบไปที่ "จัดการหัวข้อ" เพื่อเพิ่ม</div>';

  const mergeStatus = document.getElementById('mr-merge-status');
  if (mergeStatus) {
    mergeStatus.textContent = currentReport?.merged_pdf_url
      ? 'มีไฟล์ PDF รวมแล้ว — กดปุ่มขวาเพื่อสร้างใหม่ (แทนที่ไฟล์เดิม)'
      : 'ยังไม่มีไฟล์ PDF รวม';
  }
}

window._mrOpenReport = async function (reportId) {
  injectDetailModal();
  currentReport = reports.find(r => r.id === reportId);
  if (!currentReport) return;
  currentItems = itemsByReport[reportId] || [];
  document.getElementById('mr-detail-title').textContent =
    `${currentReport.jobs?.job_name || ''} — ${fmtMonth(currentReport.report_month)}`;
  document.getElementById('mr-project-name').value = currentReport.project_name || '';
  document.getElementById('mr-contract-no').value  = currentReport.contract_no || '';
  renderDetailBody();
  renderLivePreview();
  document.getElementById('modal-mr-detail').classList.add('open');
};
window._mrCloseDetail = function () {
  document.getElementById('modal-mr-detail')?.classList.remove('open');
  currentReport = null;
  renderTab();
};

window._mrSaveMeta = async function () {
  if (!currentReport) return;
  const project_name = document.getElementById('mr-project-name').value.trim();
  const contract_no  = document.getElementById('mr-contract-no').value.trim();
  if (project_name === (currentReport.project_name||'') && contract_no === (currentReport.contract_no||'')) return;
  try {
    const { error } = await sb.from('monthly_reports').update({ project_name, contract_no, updated_at: new Date().toISOString() }).eq('id', currentReport.id);
    if (error) throw error;
    currentReport.project_name = project_name;
    currentReport.contract_no  = contract_no;
    const idx = reports.findIndex(r => r.id === currentReport.id);
    if (idx > -1) { reports[idx].project_name = project_name; reports[idx].contract_no = contract_no; }
  } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message); }
};

window._mrItemFileChange = async function (topicId, input) {
  const file = input.files?.[0];
  if (!file || !currentReport) return;
  try {
    toast('กำลังอัพโหลดไฟล์...', 1500);
    const [url, page_count] = await Promise.all([
      uploadItemFile(currentReport.id, topicId, file),
      computePageCount(file),
    ]);
    const payload = {
      report_id: currentReport.id, topic_id: topicId,
      file_url: url, file_name: file.name, file_type: file.type, page_count,
      uploaded_by: window._mrCurrentUserId,
    };
    const { data, error } = await sb.from('monthly_report_items')
      .upsert(payload, { onConflict: 'report_id,topic_id' })
      .select().single();
    if (error) throw error;
    currentItems = currentItems.filter(i => i.topic_id !== topicId).concat(data);
    itemsByReport[currentReport.id] = currentItems;
    renderDetailBody();
    renderLivePreview();
    toast('แนบไฟล์แล้ว');
  } catch (e) { toast('เกิดข้อผิดพลาด: ' + e.message); }
};

window._mrItemRemove = async function (topicId) {
  const item = currentItems.find(i => i.topic_id === topicId);
  if (!item) return;
  const ok = await window.appConfirm({ title: 'ลบไฟล์แนบ', message: 'ต้องการลบไฟล์นี้ออกใช่ไหม?', okText: 'ลบ', okColor: '#e53e3e' });
  if (!ok) return;
  try {
    const { error } = await sb.from('monthly_report_items').delete().eq('id', item.id);
    if (error) throw error;
    currentItems = currentItems.filter(i => i.topic_id !== topicId);
    itemsByReport[currentReport.id] = currentItems;
    renderDetailBody();
    renderLivePreview();
    toast('ลบไฟล์แล้ว');
  } catch (e) { toast('เกิดข้อผิดพลาด: ' + e.message); }
};

// ── Topics manager modal ──────────────────────────────────────
function injectTopicsModal() {
  if (document.getElementById('modal-mr-topics')) return;
  document.body.insertAdjacentHTML('beforeend', `
<div class="modal-overlay" id="modal-mr-topics">
  <div class="modal-box" style="max-width:680px;width:90vw;display:flex;flex-direction:column;max-height:90vh">
    <div class="modal-head">
      <h3>จัดการหัวข้อรายงาน</h3>
      <button class="modal-close" onclick="document.getElementById('modal-mr-topics').classList.remove('open')">✕</button>
    </div>
    <div class="modal-body" style="overflow-y:auto;flex:1">
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
        <button class="btn btn-primary btn-sm" onclick="window._mrAddMain()">+ เพิ่มหมวดหลัก</button>
      </div>
      <div id="mr-topics-mgr-list"></div>
    </div>
  </div>
</div>`);
}

function allMains()        { return topics.filter(t => !t.parent_id).sort((a,b)=>a.sort_order-b.sort_order); }
function allSubsOf(id)     { return topics.filter(t => t.parent_id === id).sort((a,b)=>a.sort_order-b.sort_order); }

function topicMgrRowHTML(t, isSub) {
  const dis = !t.is_active;
  return `
  <div style="display:flex;align-items:center;gap:8px;padding:6px 0;${dis?'opacity:.45':''}${isSub?';padding-left:24px':''}">
    <span style="cursor:grab;color:#cbd5e1;font-size:15px;user-select:none;flex-shrink:0" title="ลากเพื่อเรียงลำดับ">⠿</span>
    <input class="form-control" style="width:60px;height:32px;font-size:12px" value="${escH(t.code)}"
      onblur="window._mrTopicEdit('${t.id}','code',this.value)">
    <input class="form-control" style="flex:1;height:32px;font-size:13px" value="${escH(t.title)}"
      onblur="window._mrTopicEdit('${t.id}','title',this.value)">
    <button class="btn btn-sm btn-outline" style="font-size:11px" onclick="window._mrTopicToggle('${t.id}',${!t.is_active})">${dis?'เปิดใช้':'ปิดใช้'}</button>
    <button class="btn btn-sm btn-danger" style="font-size:11px" onclick="window._mrTopicDelete('${t.id}')">ลบ</button>
  </div>`;
}

function renderTopicsMgr() {
  const el = document.getElementById('mr-topics-mgr-list');
  if (!el) return;
  const mainList = allMains();
  const html = mainList.map((m, mIdx) => {
    const subList = allSubsOf(m.id);
    return `
    <div draggable="true"
         ondragstart="window._mrMainDragStart(event,${mIdx})"
         ondragover="window._mrMainDragOver(event)"
         ondrop="window._mrMainDrop(event,${mIdx})"
         ondragend="window._mrMainDragEnd(event)"
         style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px">
      ${topicMgrRowHTML(m, false)}
      ${subList.map((s, sIdx) => `
        <div draggable="true"
             ondragstart="window._mrSubDragStart(event,'${m.id}',${sIdx})"
             ondragover="window._mrSubDragOver(event)"
             ondrop="window._mrSubDrop(event,'${m.id}',${sIdx})"
             ondragend="window._mrSubDragEnd(event)">
          ${topicMgrRowHTML(s, true)}
        </div>`).join('')}
      <div style="padding-left:24px;margin-top:4px">
        <button class="btn btn-sm btn-outline" style="font-size:11px" onclick="window._mrAddSub('${m.id}')">+ เพิ่มหัวข้อย่อย</button>
      </div>
    </div>`;
  }).join('');
  el.innerHTML = html || '<div style="color:#94a3b8;text-align:center;padding:20px">ยังไม่มีหัวข้อ</div>';
}

// ── Drag & drop reorder (main topics, and sub-topics within their parent) ─
let _topicDragCtx = null;

window._mrMainDragStart = function (e, idx) {
  _topicDragCtx = { kind: 'main', fromIndex: idx };
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '.4';
};
window._mrMainDragOver = function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
window._mrMainDragEnd = function (e) { e.currentTarget.style.opacity = ''; _topicDragCtx = null; };
window._mrMainDrop = async function (e, idx) {
  e.preventDefault();
  if (!_topicDragCtx || _topicDragCtx.kind !== 'main') return;
  const fromIdx = _topicDragCtx.fromIndex;
  _topicDragCtx = null;
  if (fromIdx === idx) return;
  const list = allMains();
  const moved = list.splice(fromIdx, 1)[0];
  list.splice(idx, 0, moved);
  // renumber every main (multiples of 10) and cascade-renumber their subs
  // to stay relative to the parent's new position
  const updates = [];
  list.forEach((m, i) => {
    const newOrder = (i + 1) * 10;
    updates.push({ id: m.id, sort_order: newOrder });
    allSubsOf(m.id).forEach((s, si) => updates.push({ id: s.id, sort_order: newOrder + si + 1 }));
  });
  try {
    await Promise.all(updates.map(u => sb.from('monthly_report_topics').update({ sort_order: u.sort_order }).eq('id', u.id)));
    updates.forEach(u => { const t = topics.find(x => x.id === u.id); if (t) t.sort_order = u.sort_order; });
    renderTopicsMgr();
    renderTab();
  } catch (err) { toast('เกิดข้อผิดพลาด: ' + err.message); }
};

window._mrSubDragStart = function (e, parentId, idx) {
  e.stopPropagation();
  _topicDragCtx = { kind: 'sub', parentId, fromIndex: idx };
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '.4';
};
window._mrSubDragOver = function (e) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; };
window._mrSubDragEnd = function (e) { e.currentTarget.style.opacity = ''; _topicDragCtx = null; };
window._mrSubDrop = async function (e, parentId, idx) {
  e.preventDefault();
  e.stopPropagation();
  if (!_topicDragCtx || _topicDragCtx.kind !== 'sub' || _topicDragCtx.parentId !== parentId) return;
  const fromIdx = _topicDragCtx.fromIndex;
  _topicDragCtx = null;
  if (fromIdx === idx) return;
  const main = topics.find(t => t.id === parentId);
  if (!main) return;
  const list = allSubsOf(parentId);
  const moved = list.splice(fromIdx, 1)[0];
  list.splice(idx, 0, moved);
  const updates = list.map((s, i) => ({ id: s.id, sort_order: main.sort_order + i + 1 }));
  try {
    await Promise.all(updates.map(u => sb.from('monthly_report_topics').update({ sort_order: u.sort_order }).eq('id', u.id)));
    updates.forEach(u => { const t = topics.find(x => x.id === u.id); if (t) t.sort_order = u.sort_order; });
    renderTopicsMgr();
    renderTab();
  } catch (err) { toast('เกิดข้อผิดพลาด: ' + err.message); }
};

window._mrOpenTopics = function () {
  injectTopicsModal();
  renderTopicsMgr();
  document.getElementById('modal-mr-topics').classList.add('open');
};

window._mrTopicEdit = async function (id, field, value) {
  const t = topics.find(x => x.id === id);
  if (!t || t[field] === value) return;
  try {
    const { error } = await sb.from('monthly_report_topics').update({ [field]: value }).eq('id', id);
    if (error) throw error;
    t[field] = value;
    renderTab();
  } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message); }
};

window._mrTopicToggle = async function (id, active) {
  try {
    const { error } = await sb.from('monthly_report_topics').update({ is_active: active }).eq('id', id);
    if (error) throw error;
    const t = topics.find(x => x.id === id);
    if (t) t.is_active = active;
    renderTopicsMgr();
    renderTab();
  } catch (e) { toast('เกิดข้อผิดพลาด: ' + e.message); }
};

window._mrTopicDelete = async function (id) {
  const t = topics.find(x => x.id === id);
  if (!t) return;
  const isMain = !t.parent_id;
  const children = isMain ? topics.filter(x => x.parent_id === id) : [];
  const msg = children.length
    ? `ต้องการลบหมวด "${t.title}" พร้อมหัวข้อย่อยทั้งหมด (${children.length} รายการ) ใช่ไหม? (ลบไม่ได้ถ้ามีรายงานแนบไฟล์ไว้แล้ว — ใช้ "ปิดใช้" แทนได้)`
    : `ต้องการลบหัวข้อ "${t.title}" ใช่ไหม? (ลบไม่ได้ถ้ามีรายงานแนบไฟล์ไว้แล้ว — ใช้ "ปิดใช้" แทนได้)`;
  const ok = await window.appConfirm({ title: 'ลบหัวข้อ', message: msg, okText: 'ลบ', okColor: '#e53e3e' });
  if (!ok) return;
  try {
    const { error } = await sb.from('monthly_report_topics').delete().eq('id', id);
    if (error) throw error;
    const removedIds = new Set([id, ...children.map(c => c.id)]);
    topics = topics.filter(x => !removedIds.has(x.id));
    renderTopicsMgr();
    renderTab();
    toast('ลบหัวข้อแล้ว');
  } catch (e) {
    toast('ลบไม่ได้: มีรายงานแนบไฟล์ในหัวข้อนี้อยู่แล้ว ใช้ปุ่ม "ปิดใช้" แทนได้ครับ');
  }
};

window._mrAddMain = async function () {
  const mainsAll = topics.filter(t => !t.parent_id);
  const nums = mainsAll.map(t => parseInt(t.code)).filter(n => !isNaN(n));
  const nextCode = String((nums.length ? Math.max(...nums) : 0) + 1);
  const maxOrder = mainsAll.length ? Math.max(...mainsAll.map(t => t.sort_order)) : 0;
  const sort_order = Math.ceil((maxOrder + 1) / 10) * 10;
  try {
    const { data, error } = await sb.from('monthly_report_topics')
      .insert({ code: nextCode, title: 'หัวข้อใหม่', sort_order }).select().single();
    if (error) throw error;
    topics.push(data);
    renderTopicsMgr();
    renderTab();
  } catch (e) { toast('เกิดข้อผิดพลาด: ' + e.message); }
};

window._mrAddSub = async function (mainId) {
  const main = topics.find(t => t.id === mainId);
  if (!main) return;
  const subs = topics.filter(t => t.parent_id === mainId);
  const nextCode = `${main.code}.${subs.length + 1}`;
  const sort_order = main.sort_order + subs.length + 1;
  try {
    const { data, error } = await sb.from('monthly_report_topics')
      .insert({ code: nextCode, parent_id: mainId, title: 'หัวข้อย่อยใหม่', sort_order }).select().single();
    if (error) throw error;
    topics.push(data);
    renderTopicsMgr();
    renderTab();
  } catch (e) { toast('เกิดข้อผิดพลาด: ' + e.message); }
};

// ── PDF merge ─────────────────────────────────────────────────
const A4W = 595.28, A4H = 841.89;

// Organic "blob" accent shape — soft irregular rounded rectangle, used in
// the page corners for the light corporate-report background treatment.
function blobHTML(style) {
  return `<div style="position:absolute;${style}"></div>`;
}

// A rotated rounded-square "frame" standing in for a cropped project photo
// (no real photos available yet) — filled with a diagonal blue gradient to
// suggest glass/steel without using any third-party image.
function photoFrameHTML(size, top, left, gradient, rotateDeg) {
  return `
    <div style="position:absolute;width:${size}%;aspect-ratio:1/1;top:${top}%;left:${left}%;transform:rotate(${rotateDeg}deg);border-radius:18%;overflow:hidden;box-shadow:0 10px 22px rgba(15,41,66,.22)">
      <div style="position:absolute;inset:-35%;background:${gradient};transform:rotate(${-rotateDeg}deg)"></div>
    </div>`;
}

// Corporate cover in the style of a modern annual-report template: two
// diamond "photo" frames linked by a thin line-and-dot chain, soft organic
// color blobs in the corners, italic bold title, numbered footer facts —
// self-contained (fills its parent edge to edge), no third-party images.
function coverContentHTML(report) {
  const job = jobsCache.find(j => j.id === report.job_id);
  const initial = escH((report.project_name || job?.job_name || 'P').trim().charAt(0).toUpperCase() || 'P');
  const year = new Date(report.report_month).getFullYear();
  const monthName = new Date(report.report_month).toLocaleDateString('en-GB', { month: 'long' });
  const dot = (top, left, size = 1.1) => `<div style="position:absolute;width:${size}em;height:${size}em;border-radius:50%;background:#2d6a9f;top:${top}%;left:${left}%;transform:translate(-50%,-50%);box-shadow:0 2px 6px rgba(15,41,66,.3)"></div>`;
  const leaderLine = (top, left, w, deg) => `<div style="position:absolute;width:${w}%;height:1.5px;background:#2d6a9f;top:${top}%;left:${left}%;transform:rotate(${deg}deg);transform-origin:0 0;opacity:.55"></div>`;
  return `
    <div style="position:absolute;inset:0;background:#ffffff;overflow:hidden">
      ${blobHTML('width:46%;height:24%;top:-7%;left:-14%;background:#152a4d;border-radius:38% 62% 63% 37% / 41% 44% 56% 59%;transform:rotate(-8deg)')}
      ${blobHTML('width:56%;height:22%;top:-10%;left:10%;background:#8fc0e3;border-radius:47% 53% 39% 61% / 56% 60% 40% 44%;transform:rotate(6deg);opacity:.85')}
      ${blobHTML('width:42%;height:28%;top:26%;left:-18%;background:#2d6a9f;border-radius:56% 44% 42% 58% / 52% 40% 60% 48%;transform:rotate(-6deg);opacity:.92')}
      ${blobHTML('width:62%;height:24%;bottom:-8%;right:-16%;background:linear-gradient(135deg,#eef5fb,#dcebf6);border-radius:60% 40% 44% 56% / 46% 54% 46% 54%;transform:rotate(-4deg)')}
      ${leaderLine(16, 4, 30, 27)}
      ${dot(16, 4, 0.7)}
      ${leaderLine(30, 30, 22, 32)}
      ${dot(30, 30, 0.9)}
      ${dot(55, 46, 0.7)}
      ${photoFrameHTML(25, 10, 45, 'linear-gradient(135deg,#0f2942 0%,#3f83b8 55%,#bcdcf0 100%)', 45)}
      ${photoFrameHTML(28, 33, 12, 'linear-gradient(135deg,#12345c 0%,#4a8bc2 55%,#a9d2ec 100%)', 45)}
    </div>
    <div style="position:relative;height:100%;box-sizing:border-box;color:#1a3c5e">
      <div style="position:absolute;top:44%;right:8%;display:flex;align-items:center;gap:.5em">
        <div style="width:2em;height:2em;border-radius:50%;background:#fff;border:1.5px solid #2d6a9f;display:flex;align-items:center;justify-content:center;font-size:.9em;font-weight:800;color:#2d6a9f;box-shadow:0 3px 10px rgba(15,41,66,.15)">${initial}</div>
        <div style="font-size:.65em;letter-spacing:1.5px;color:#94a3b8;font-style:italic">YOUR REPORT</div>
      </div>
      <div style="position:absolute;top:57%;right:8%;left:8%;text-align:right">
        <div style="font-size:1.5em;font-weight:800;font-style:italic;color:#334155">${year}</div>
        <div style="font-size:2.15em;font-weight:800;font-style:italic;color:#1a3c5e;line-height:1.05;margin-top:.05em">MONTHLY</div>
        <div style="font-size:2.15em;font-weight:800;font-style:italic;color:#5a9bcf;line-height:1.05;text-shadow:0 2px 10px rgba(45,106,159,.2)">PROGRESS<br>REPORT</div>
      </div>
      <div style="position:absolute;top:81%;right:8%;left:8%;text-align:right;font-size:.8em;color:#64748b;line-height:1.6">
        รายงานความก้าวหน้าประจำเดือน ${escH(monthName)} ${year}
      </div>
      <div style="position:absolute;bottom:5%;left:8%;right:8%;display:flex;justify-content:space-between;gap:1em">
        <div style="display:flex;align-items:flex-start;gap:.5em;text-align:left;max-width:48%">
          <div style="width:1.7em;height:1.7em;border-radius:50%;background:#152a4d;color:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.7em;font-weight:800">01</div>
          <div>
            <div style="font-size:.62em;letter-spacing:1px;color:#94a3b8">PROJECT</div>
            <div style="font-size:.72em;font-weight:700;color:#1a3c5e;line-height:1.4">${escH(report.project_name || job?.job_name || 'ยังไม่ระบุชื่อโครงการ')}</div>
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:.5em;text-align:left;max-width:48%">
          <div style="width:1.7em;height:1.7em;border-radius:50%;background:#152a4d;color:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.7em;font-weight:800">02</div>
          <div>
            <div style="font-size:.62em;letter-spacing:1px;color:#94a3b8">COMPANY</div>
            <div style="font-size:.72em;font-weight:700;color:#1a3c5e;line-height:1.4">${report.companies?.name ? escH(report.companies.name) : ''}</div>
            <div style="font-size:.68em;color:#94a3b8">${report.contract_no ? 'Contract No. ' + escH(report.contract_no) : ''}</div>
          </div>
        </div>
      </div>
    </div>`;
}

// Section divider — same color language as the cover (badge + accent band)
// but lighter, so it reads as "you're entering a new part" without
// overpowering the plain content pages around it.
function sectionCoverContentHTML(topic) {
  return `
    <div style="position:absolute;inset:0;background:#fff;overflow:hidden">
      <div style="position:absolute;width:170%;height:34%;background:linear-gradient(135deg,#1a3c5e,#2d6a9f);transform:rotate(-9deg);top:-12%;left:-35%"></div>
    </div>
    <div style="position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 12%;box-sizing:border-box">
      <div style="width:2.4em;height:2.4em;border-radius:50%;background:linear-gradient(135deg,#1a3c5e,#2d6a9f);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.1em;font-weight:800;margin-bottom:.9em;box-shadow:0 8px 20px rgba(26,60,94,.28)">${escH(topic.code)}</div>
      <div style="font-size:.72em;letter-spacing:2.5px;color:#94a3b8;margin-bottom:.5em">SECTION</div>
      <div style="font-size:1.5em;font-weight:800;color:#1a3c5e;text-align:center;line-height:1.4">${escH(topic.title)}</div>
    </div>`;
}

function tocContentHTML() {
  const pageMap = computePageNumbers();
  const pageLabel = (id) => pageMap[id] != null ? pageMap[id] : '—';
  const rows = activeMains().map(m => {
    const subs = activeSubsOf(m.id);
    const subRows = subs.map(s => `
      <div style="display:flex;align-items:center;padding:.3em 0 .3em 2.4em;font-size:.93em">
        <div style="width:3.5em">${escH(s.code)}</div>
        <div style="flex:1">${escH(s.title)}</div>
        <div style="width:2.4em;text-align:right;color:#666">${pageLabel(s.id)}</div>
      </div>`).join('');
    return `
      <div style="display:flex;align-items:center;padding:.55em 0 .3em;font-size:1em;font-weight:700">
        <div style="width:3.5em">${escH(m.code)}</div>
        <div style="flex:1">${escH(m.title)}</div>
        <div style="width:2.4em;text-align:right;color:#666">${pageLabel(m.id)}</div>
      </div>
      ${subRows}`;
  }).join('');
  return `
    <div style="text-align:center;font-size:1.4em;font-weight:800;margin-bottom:1.6em">TABLE OF CONTENTS</div>
    <div style="display:flex;font-size:.93em;font-weight:700;color:#888;border-bottom:1px solid #ddd;padding-bottom:.4em;margin-bottom:.4em">
      <div style="width:3.5em">Item</div><div style="flex:1">Description</div><div style="width:2.4em;text-align:right">Page</div>
    </div>
    ${rows || '<div style="color:#bbb;text-align:center;padding:20px">ยังไม่มีหัวข้อ</div>'}`;
}

function buildCoverElement(report) {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;height:1123px;overflow:hidden;font-family:Sarabun,sans-serif;font-size:16px;';
  div.innerHTML = coverContentHTML(report);
  return div;
}

function buildTocElement() {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;min-height:1123px;background:#fff;padding:60px;box-sizing:border-box;font-family:Sarabun,sans-serif;color:#1a3c5e;font-size:16px;';
  div.innerHTML = tocContentHTML();
  return div;
}

function buildSectionCoverElement(topic) {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;height:1123px;overflow:hidden;font-family:Sarabun,sans-serif;font-size:16px;';
  div.innerHTML = sectionCoverContentHTML(topic);
  return div;
}

// ── PDF page rasterization — renders every page of an attached PDF as a
// flat PNG, so it looks identical to the custom-built cover/TOC page cards
// instead of an embedded native PDF viewer (which has its own scrollbar/UI).
const PDFJS_VER = '4.0.379';
async function renderPdfPagesToImages(url) {
  if (pdfPageThumbCache[url]) return pdfPageThumbCache[url];
  try {
    const pdfjsLib = await import(`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.min.mjs`);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.worker.min.mjs`;
    const doc = await pdfjsLib.getDocument(url).promise;
    const images = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      images.push({ url: canvas.toDataURL('image/png'), landscape: viewport.width > viewport.height });
    }
    pdfPageThumbCache[url] = images;
    return images;
  } catch (e) {
    pdfPageThumbCache[url] = [];
    return [];
  }
}

function pageCardHTML(label, innerHTML, landscape) {
  return `
    <div style="text-align:center;font-size:10px;color:#bbb;margin:8px 0">${label}</div>
    <div style="background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.06);width:100%;aspect-ratio:${landscape ? '297/210' : '210/297'};overflow:hidden;margin-bottom:4px;display:flex;align-items:center;justify-content:center">
      ${innerHTML}
    </div>`;
}

// for self-contained page content (cover, section dividers) that manages
// its own full-bleed background — no white bg/padding from the card itself
function rawPageCardHTML(label, innerHTML) {
  return `
    <div style="text-align:center;font-size:10px;color:#bbb;margin:8px 0">${label}</div>
    <div style="position:relative;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.06);width:100%;aspect-ratio:210/297;overflow:hidden;margin-bottom:4px;font-family:Sarabun,sans-serif;font-size:13px">
      ${innerHTML}
    </div>`;
}

// ── Live preview panel (right side of the report detail modal) ─
// Every page — cover, TOC, and every page of every attached file — renders
// as the same flat white "page card", stacked in order, so the whole
// preview reads as one continuous document.
function renderLivePreview() {
  const el = document.getElementById('mr-live-preview');
  if (!el || !currentReport) return;
  const token = ++previewToken;
  const leaves = leafTopicsInOrder();
  const done = leaves.filter(t => currentItems.some(i => i.topic_id === t.id && i.file_url)).length;
  const pageMap = computePageNumbers();

  const pendingPdfUrls = [];
  const pendingImageUrls = [];
  const attachedPages = documentFlowInOrder().map(entry => {
    const t = entry.topic;
    if (entry.kind === 'section') {
      return rawPageCardHTML(`หน้า ${pageMap[t.id]} — เริ่มหมวด ${escH(t.code)}`, sectionCoverContentHTML(t));
    }
    const item = currentItems.find(i => i.topic_id === t.id && i.file_url);
    if (!item) return '';
    const isImg = (item.file_type || '').startsWith('image/');
    const label = `${escH(t.code)} ${escH(t.title)}`;
    if (isImg) {
      const landscape = imageOrientationCache[item.file_url];
      if (landscape === undefined) pendingImageUrls.push(item.file_url);
      return pageCardHTML(`หน้า ${pageMap[t.id]} — ${label}`,
        `<img src="${escH(item.file_url)}" style="width:100%;height:100%;object-fit:contain;background:#fff">`, !!landscape);
    }
    const cached = pdfPageThumbCache[item.file_url];
    if (cached === undefined) pendingPdfUrls.push(item.file_url);
    if (!cached || !cached.length) {
      return pageCardHTML(`หน้า ${pageMap[t.id]} — ${label}`,
        `<span style="color:#94a3b8;font-size:12px">${cached ? 'ไม่สามารถแสดงตัวอย่างได้' : 'กำลังโหลดตัวอย่าง...'}</span>`);
    }
    return cached.map((p, i) => pageCardHTML(
      `หน้า ${pageMap[t.id] + i} — ${label}${cached.length > 1 ? ` (${i + 1}/${cached.length})` : ''}`,
      `<img src="${p.url}" style="width:100%;height:100%;object-fit:contain;background:#fff">`, p.landscape
    )).join('');
  }).join('');

  el.innerHTML = `
    ${rawPageCardHTML('หน้า 1 — ปก', coverContentHTML(currentReport))}
    <div style="text-align:center;font-size:11px;color:#888;margin-bottom:8px">แนบไฟล์แล้ว ${done}/${leaves.length} หัวข้อ</div>
    <div style="text-align:center;font-size:10px;color:#bbb;margin-bottom:8px">หน้า 2 — สารบัญ</div>
    <div style="background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.06);width:100%;min-height:calc(100% * 297 / 210);padding:9% 7%;box-sizing:border-box;font-family:Sarabun,sans-serif;color:#1a3c5e;font-size:12px;margin-bottom:8px">
      ${tocContentHTML()}
    </div>
    ${attachedPages}`;

  const pending = [
    ...pendingPdfUrls.map(u => renderPdfPagesToImages(u)),
    ...pendingImageUrls.map(u => probeImageOrientation(u)),
  ];
  if (pending.length) {
    Promise.all(pending).then(() => {
      if (token === previewToken) renderLivePreview();
    });
  }
}

async function addImagePageFromDataUrl(pdfDoc, dataUrl) {
  const bytes = await fetch(dataUrl).then(r => r.arrayBuffer());
  const img = await pdfDoc.embedPng(bytes);
  const scale = Math.min(A4W / img.width, A4H / img.height);
  const w = img.width * scale, h = img.height * scale;
  const page = pdfDoc.addPage([A4W, A4H]);
  page.drawImage(img, { x: (A4W - w) / 2, y: A4H - h, width: w, height: h });
}

async function addImagePageFromFile(pdfDoc, bytes, mimeType) {
  const img = /jpe?g/i.test(mimeType) ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
  // landscape source images get a landscape A4 page instead of being
  // squeezed into a portrait one, matching the live preview's sizing
  const landscape = img.width > img.height;
  const pageW = landscape ? A4H : A4W;
  const pageH = landscape ? A4W : A4H;
  const pad = 30;
  const scale = Math.min((pageW - pad*2) / img.width, (pageH - pad*2) / img.height);
  const w = img.width * scale, h = img.height * scale;
  const page = pdfDoc.addPage([pageW, pageH]);
  page.drawImage(img, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
}

window._mrMerge = async function () {
  if (!currentReport) return;
  const btn = document.getElementById('mr-merge-btn');
  const status = document.getElementById('mr-merge-status');
  btn.disabled = true;
  const setStatus = (t) => { if (status) status.textContent = t; };
  try {
    setStatus('กำลังโหลดไลบรารี PDF...');
    const [{ PDFDocument }, html2canvasMod] = await Promise.all([
      import('https://esm.sh/pdf-lib@1.17.1'),
      import('https://esm.sh/html2canvas@1.4.1'),
    ]);
    const html2canvas = html2canvasMod.default;
    const pdfDoc = await PDFDocument.create();

    setStatus('กำลังสร้างหน้าปก...');
    const coverEl = buildCoverElement(currentReport);
    document.body.appendChild(coverEl);
    const coverCanvas = await html2canvas(coverEl, { scale: 2, backgroundColor: '#ffffff' });
    document.body.removeChild(coverEl);
    await addImagePageFromDataUrl(pdfDoc, coverCanvas.toDataURL('image/png'));

    setStatus('กำลังสร้างสารบัญ...');
    const tocEl = buildTocElement();
    document.body.appendChild(tocEl);
    const tocCanvas = await html2canvas(tocEl, { scale: 2, backgroundColor: '#ffffff' });
    document.body.removeChild(tocEl);
    await addImagePageFromDataUrl(pdfDoc, tocCanvas.toDataURL('image/png'));

    const flow = documentFlowInOrder();
    let n = 0;
    for (const entry of flow) {
      n++;
      const topic = entry.topic;
      if (entry.kind === 'section') {
        setStatus(`กำลังสร้างหน้าแบ่งหมวด (${n}/${flow.length}) — ${topic.title}...`);
        const sectionEl = buildSectionCoverElement(topic);
        document.body.appendChild(sectionEl);
        const sectionCanvas = await html2canvas(sectionEl, { scale: 2, backgroundColor: '#ffffff' });
        document.body.removeChild(sectionEl);
        await addImagePageFromDataUrl(pdfDoc, sectionCanvas.toDataURL('image/png'));
        continue;
      }
      const item = currentItems.find(i => i.topic_id === topic.id);
      if (!item?.file_url) continue;
      setStatus(`กำลังรวมไฟล์ (${n}/${flow.length}) — ${topic.title}...`);
      const bytes = await fetch(item.file_url).then(r => r.arrayBuffer());
      if (item.file_type === 'application/pdf') {
        const src = await PDFDocument.load(bytes);
        const copied = await pdfDoc.copyPages(src, src.getPageIndices());
        copied.forEach(p => pdfDoc.addPage(p));
      } else {
        await addImagePageFromFile(pdfDoc, bytes, item.file_type);
      }
    }

    setStatus('กำลังบันทึกไฟล์...');
    const finalBytes = await pdfDoc.save();
    const blob = new Blob([finalBytes], { type: 'application/pdf' });
    const path = `${currentReport.id}/merged.pdf`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'application/pdf' });
    if (upErr) throw upErr;
    const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(path);
    const merged_pdf_url = urlData.publicUrl + '?v=' + Date.now();

    const { error } = await sb.from('monthly_reports').update({ merged_pdf_url, updated_at: new Date().toISOString() }).eq('id', currentReport.id);
    if (error) throw error;
    currentReport.merged_pdf_url = merged_pdf_url;
    const idx = reports.findIndex(r => r.id === currentReport.id);
    if (idx > -1) reports[idx].merged_pdf_url = merged_pdf_url;

    setStatus('สร้างไฟล์ PDF รวมสำเร็จ!');
    toast('สร้างไฟล์ PDF รวมสำเร็จ');
    window.open(merged_pdf_url, '_blank');
  } catch (e) {
    setStatus('เกิดข้อผิดพลาด: ' + e.message);
    toast('เกิดข้อผิดพลาด: ' + e.message, 5000);
  } finally {
    btn.disabled = false;
  }
};
