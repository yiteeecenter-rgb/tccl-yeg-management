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
function progressOf(reportId) {
  const leaves = leafTopicsInOrder();
  const items = itemsByReport[reportId] || [];
  const done = leaves.filter(t => items.some(i => i.topic_id === t.id && i.file_url)).length;
  return { done, total: leaves.length };
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
  return data.publicUrl;
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
  <div class="modal-box" id="modal-mr-detail-box" style="max-width:820px;width:92vw;display:flex;flex-direction:column;max-height:92vh">
    <div class="modal-head">
      <h3 id="mr-detail-title">รายงานประจำเดือน</h3>
      <button class="modal-close" onclick="window._mrCloseDetail()">✕</button>
    </div>
    <div class="modal-body" style="overflow-y:auto;flex:1">
      <div class="form-row" style="margin-bottom:18px">
        <div class="form-group">
          <label>ชื่อโครงการ</label>
          <input class="form-control" id="mr-project-name" onblur="window._mrSaveMeta()">
        </div>
        <div class="form-group">
          <label>เลขที่สัญญา (Contract No.)</label>
          <input class="form-control" id="mr-contract-no" onblur="window._mrSaveMeta()">
        </div>
      </div>
      <div id="mr-topics-list"></div>
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
        ? `<img src="${escH(item.file_url)}" class="photo-preview" style="width:36px;height:36px" onclick="window.open('${escH(item.file_url)}','_blank')">`
        : `<button class="btn btn-sm btn-outline" onclick="window.open('${escH(item.file_url)}','_blank')">📄 ${escH(item.file_name||'ไฟล์')}</button>`}
      <button class="btn-del-row" title="ลบไฟล์" onclick="window._mrItemRemove('${topic.id}')">✕</button>
    ` : `
      <label class="btn btn-sm btn-outline" style="cursor:pointer;margin:0">
        แนบไฟล์
        <input type="file" accept="image/png,image/jpeg,application/pdf" style="display:none" onchange="window._mrItemFileChange('${topic.id}',this)">
      </label>
    `}
  </div>`;
}

function renderDetailBody() {
  const el = document.getElementById('mr-topics-list');
  if (!el) return;
  showInactiveTopics = false;
  const html = mains().map(m => {
    const subs = subsOf(m.id);
    if (subs.length === 0) {
      // leaf main item (e.g. 9, 10, 11)
      return `<div style="margin-bottom:10px">
        <div style="font-size:13px;font-weight:700;color:#1a3c5e;margin-bottom:6px">${escH(m.code)}  ${escH(m.title)}</div>
        ${leafRowHTML(m)}
      </div>`;
    }
    const done = subs.filter(s => currentItems.some(i => i.topic_id === s.id && i.file_url)).length;
    return `
      <div style="margin-bottom:14px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <div style="background:#f7fafc;padding:10px 14px;font-size:13.5px;font-weight:700;color:#1a3c5e;display:flex;justify-content:space-between;align-items:center">
          <span>${escH(m.code)}  ${escH(m.title)}</span>
          <span class="badge ${done===subs.length?'badge-approved':'badge-pending'}">${done}/${subs.length}</span>
        </div>
        <div style="padding:10px 14px">
          ${subs.map(s => leafRowHTML(s)).join('')}
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
    const url = await uploadItemFile(currentReport.id, topicId, file);
    const payload = {
      report_id: currentReport.id, topic_id: topicId,
      file_url: url, file_name: file.name, file_type: file.type,
      uploaded_by: window._mrCurrentUserId,
    };
    const { data, error } = await sb.from('monthly_report_items')
      .upsert(payload, { onConflict: 'report_id,topic_id' })
      .select().single();
    if (error) throw error;
    currentItems = currentItems.filter(i => i.topic_id !== topicId).concat(data);
    itemsByReport[currentReport.id] = currentItems;
    renderDetailBody();
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

function topicMgrRowHTML(t, isSub) {
  const dis = !t.is_active;
  return `
  <div style="display:flex;align-items:center;gap:8px;padding:6px 0;${dis?'opacity:.45':''}${isSub?';padding-left:24px':''}">
    <input class="form-control" style="width:60px;height:32px;font-size:12px" value="${escH(t.code)}"
      onblur="window._mrTopicEdit('${t.id}','code',this.value)">
    <input class="form-control" style="flex:1;height:32px;font-size:13px" value="${escH(t.title)}"
      onblur="window._mrTopicEdit('${t.id}','title',this.value)">
    <button class="btn btn-sm btn-outline" style="font-size:11px" onclick="window._mrTopicToggle('${t.id}',${!t.is_active})">${dis?'เปิดใช้':'ปิดใช้'}</button>
  </div>`;
}

function renderTopicsMgr() {
  const el = document.getElementById('mr-topics-mgr-list');
  if (!el) return;
  showInactiveTopics = true;
  const html = mains().map(m => `
    <div style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px">
      ${topicMgrRowHTML(m, false)}
      ${subsOf(m.id).map(s => topicMgrRowHTML(s, true)).join('')}
      <div style="padding-left:24px;margin-top:4px">
        <button class="btn btn-sm btn-outline" style="font-size:11px" onclick="window._mrAddSub('${m.id}')">+ เพิ่มหัวข้อย่อย</button>
      </div>
    </div>`).join('');
  el.innerHTML = html || '<div style="color:#94a3b8;text-align:center;padding:20px">ยังไม่มีหัวข้อ</div>';
  showInactiveTopics = false;
}

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

function buildCoverElement(report) {
  const job = jobsCache.find(j => j.id === report.job_id);
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;height:1123px;background:#fff;padding:80px 60px;box-sizing:border-box;font-family:Sarabun,sans-serif;color:#1a3c5e;';
  div.innerHTML = `
    <div style="text-align:center;margin-top:160px">
      <div style="font-size:14px;letter-spacing:3px;color:#666;margin-bottom:28px">MONTHLY PROGRESS REPORT</div>
      <div style="font-size:28px;font-weight:800;margin-bottom:10px;line-height:1.4">${escH(report.project_name || job?.job_name || '-')}</div>
      <div style="font-size:15px;color:#555;margin-bottom:44px">${escH(job?.job_code || '')}</div>
      <div style="font-size:18px;font-weight:700;margin-bottom:70px">${fmtMonth(report.report_month)}</div>
      <div style="font-size:13px;color:#666;line-height:2">
        ${report.companies?.name ? `<div>${escH(report.companies.name)}</div>` : ''}
        ${report.contract_no ? `<div>Contract No. ${escH(report.contract_no)}</div>` : ''}
      </div>
    </div>`;
  return div;
}

function buildTocElement() {
  const rows = activeMains().map(m => {
    const subs = activeSubsOf(m.id);
    const subRows = subs.map(s => `
      <div style="display:flex;padding:4px 0 4px 34px;font-size:13px">
        <div style="width:50px">${escH(s.code)}</div>
        <div style="flex:1">${escH(s.title)}</div>
      </div>`).join('');
    return `
      <div style="display:flex;padding:8px 0 4px;font-size:14px;font-weight:700">
        <div style="width:50px">${escH(m.code)}</div>
        <div style="flex:1">${escH(m.title)}</div>
      </div>
      ${subRows}`;
  }).join('');
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;min-height:1123px;background:#fff;padding:60px;box-sizing:border-box;font-family:Sarabun,sans-serif;color:#1a3c5e;';
  div.innerHTML = `
    <div style="text-align:center;font-size:20px;font-weight:800;margin-bottom:32px">TABLE OF CONTENTS</div>
    <div style="display:flex;font-size:13px;font-weight:700;color:#888;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:6px">
      <div style="width:50px">Item</div><div style="flex:1">Description</div>
    </div>
    ${rows}`;
  return div;
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
  const pad = 30;
  const scale = Math.min((A4W - pad*2) / img.width, (A4H - pad*2) / img.height);
  const w = img.width * scale, h = img.height * scale;
  const page = pdfDoc.addPage([A4W, A4H]);
  page.drawImage(img, { x: (A4W - w) / 2, y: (A4H - h) / 2, width: w, height: h });
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

    const leaves = leafTopicsInOrder();
    let n = 0;
    for (const topic of leaves) {
      n++;
      const item = currentItems.find(i => i.topic_id === topic.id);
      if (!item?.file_url) continue;
      setStatus(`กำลังรวมไฟล์ (${n}/${leaves.length}) — ${topic.title}...`);
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
