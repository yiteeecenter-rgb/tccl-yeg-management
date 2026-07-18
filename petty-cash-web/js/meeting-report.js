import { sb } from './supabase.js';

let jobsCache      = [];
let meetings       = [];   // meeting_reports rows (joined)
let actionItemsByJob = {}; // job_id -> [meeting_action_items]
let filterJobId    = '';

let currentMeeting = null;
let currentActionItems = []; // action items for currentMeeting's job

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
function fmtDateTH(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function isOverdue(item) { return item.status === 'pending' && item.due_date && item.due_date < todayStr(); }
function itemStatusBadge(item) {
  if (item.status === 'done') return `<span class="badge badge-approved">เสร็จแล้ว</span>`;
  if (isOverdue(item)) return `<span class="badge badge-rejected">เกินกำหนด</span>`;
  return `<span class="badge badge-pending">ค้าง</span>`;
}

// ── Supabase CRUD ─────────────────────────────────────────────
async function listMeetings() {
  const { data, error } = await sb.from('meeting_reports')
    .select('*, jobs(job_name,job_code), companies(name), profiles!created_by(full_name)')
    .order('meeting_date', { ascending: false });
  if (error) throw error;
  return data || [];
}
async function listActionItems(jobIds) {
  if (!jobIds.length) return {};
  const { data, error } = await sb.from('meeting_action_items').select('*').in('job_id', jobIds).order('created_at');
  if (error) throw error;
  const map = {};
  (data || []).forEach(i => { (map[i.job_id] ??= []).push(i); });
  return map;
}

// ── Init ──────────────────────────────────────────────────────
window._mtgInit = async function () {
  const { data: { user } } = await sb.auth.getUser();
  window._mtgCurrentUserId = user?.id || null;
  try {
    const [m, jobs] = await Promise.all([
      listMeetings(),
      sb.from('jobs').select('*').eq('is_active', true).order('job_name'),
    ]);
    meetings  = m;
    jobsCache = jobs.data || [];
    const jobIds = [...new Set(jobsCache.map(j => j.id))];
    actionItemsByJob = await listActionItems(jobIds);
  } catch (e) {
    meetings = []; jobsCache = []; actionItemsByJob = {};
  }
  renderTab();
};

// ── Tab (meeting list) ────────────────────────────────────────
function renderTab() {
  const pane = document.getElementById('tab-meeting-report');
  if (!pane) return;

  const list = filterJobId ? meetings.filter(m => m.job_id === filterJobId) : meetings;

  const rows = list.length
    ? list.map(m => {
        const openCount = (actionItemsByJob[m.job_id] || []).filter(i => i.status === 'pending').length;
        return `
        <tr>
          <td><strong>${escH(m.jobs?.job_name || '—')}</strong><br><span style="font-size:11px;color:#94a3b8">${escH(m.jobs?.job_code || '')}</span></td>
          <td>${escH(m.meeting_no || '—')}</td>
          <td>${fmtDateTH(m.meeting_date)}</td>
          <td>${escH(m.location || '—')}</td>
          <td>${openCount > 0 ? `<span class="badge badge-pending">${openCount} ค้าง</span>` : `<span class="badge badge-approved">ไม่มีค้าง</span>`}</td>
          <td>${escH(m.profiles?.full_name || '—')}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-primary" onclick="window._mtgOpenMeeting('${m.id}')">เปิด</button>
            <button class="btn btn-sm btn-outline" onclick="window._mtgPrint('${m.id}')">🖨 พิมพ์</button>
            <button class="btn btn-sm btn-danger" onclick="window._mtgDeleteMeeting('${m.id}')">ลบ</button>
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8">ยังไม่มีรายงานการประชุม — กดปุ่ม <strong>+ บันทึกการประชุม</strong> เพื่อเริ่มต้น</td></tr>`;

  pane.innerHTML = `
  <div class="card">
    <div class="card-header">
      <h3>รายงานการประชุม</h3>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="form-control" style="height:36px;width:220px" onchange="window._mtgFilterJob(this)">
          <option value="">ทุกสถานี/งาน</option>
          ${jobsCache.map(j => `<option value="${j.id}" ${filterJobId===j.id?'selected':''}>${escH(j.job_name)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" onclick="window._mtgOpenNewModal()">+ บันทึกการประชุม</button>
      </div>
    </div>
    <div class="card-body">
      <table>
        <thead><tr><th>สถานี / งาน</th><th>ครั้งที่</th><th>วันที่</th><th>สถานที่</th><th>Action Item</th><th>ผู้บันทึก</th><th>จัดการ</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window._mtgFilterJob = function (sel) { filterJobId = sel.value; renderTab(); };

// ── New meeting modal ─────────────────────────────────────────
function injectNewModal() {
  if (document.getElementById('modal-mtg-new')) return;
  document.body.insertAdjacentHTML('beforeend', `
<div class="modal-overlay" id="modal-mtg-new">
  <div class="modal-box" style="max-width:420px">
    <div class="modal-head">
      <h3>บันทึกการประชุมใหม่</h3>
      <button class="modal-close" onclick="window._mtgCloseNewModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>สถานี / งาน</label>
        <select class="form-control" id="mtg-new-job"></select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>ครั้งที่</label>
          <input class="form-control" id="mtg-new-no" placeholder="เช่น 12">
        </div>
        <div class="form-group">
          <label>วันที่ประชุม</label>
          <input type="date" class="form-control" id="mtg-new-date">
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-outline" onclick="window._mtgCloseNewModal()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="window._mtgCreateMeeting()">บันทึกและเปิด</button>
    </div>
  </div>
</div>`);
}
window._mtgOpenNewModal = function () {
  injectNewModal();
  const sel = document.getElementById('mtg-new-job');
  sel.innerHTML = '<option value="">-- เลือกสถานี/งาน --</option>' +
    jobsCache.map(j => `<option value="${j.id}">${escH(j.job_name)} (${escH(j.job_code)})</option>`).join('');
  document.getElementById('mtg-new-date').value = todayStr();
  document.getElementById('mtg-new-no').value = '';
  document.getElementById('modal-mtg-new').classList.add('open');
};
window._mtgCloseNewModal = function () {
  document.getElementById('modal-mtg-new')?.classList.remove('open');
};

window._mtgCreateMeeting = async function () {
  const jobId = document.getElementById('mtg-new-job').value;
  const meetingNo = document.getElementById('mtg-new-no').value.trim();
  const meetingDate = document.getElementById('mtg-new-date').value;
  if (!jobId) return toast('กรุณาเลือกสถานี/งาน');
  if (!meetingDate) return toast('กรุณาเลือกวันที่ประชุม');
  const job = jobsCache.find(j => j.id === jobId);
  try {
    const { data, error } = await sb.from('meeting_reports').insert({
      job_id: jobId, company_id: job?.company_id || null,
      meeting_no: meetingNo, meeting_date: meetingDate,
      created_by: window._mtgCurrentUserId,
    }).select('*, jobs(job_name,job_code), companies(name), profiles!created_by(full_name)').single();
    if (error) throw error;
    meetings.unshift(data);
    window._mtgCloseNewModal();
    renderTab();
    window._mtgOpenMeeting(data.id);
  } catch (e) { toast('เกิดข้อผิดพลาด: ' + e.message); }
};

window._mtgDeleteMeeting = async function (id) {
  const ok = await window.appConfirm({ title: 'ลบรายงานการประชุม', message: 'ต้องการลบรายงานการประชุมนี้ใช่ไหม? (Action item ที่เชื่อมกับการประชุมนี้จะไม่ถูกลบ)', okText: 'ลบ', okColor: '#e53e3e' });
  if (!ok) return;
  try {
    const { error } = await sb.from('meeting_reports').delete().eq('id', id);
    if (error) throw error;
    meetings = meetings.filter(m => m.id !== id);
    toast('ลบรายงานการประชุมแล้ว');
    renderTab();
  } catch (e) { toast('เกิดข้อผิดพลาด: ' + e.message); }
};

// ── Meeting detail modal ──────────────────────────────────────
function injectDetailModal() {
  if (document.getElementById('modal-mtg-detail')) return;
  document.body.insertAdjacentHTML('beforeend', `
<div class="modal-overlay" id="modal-mtg-detail">
  <div class="modal-box" id="modal-mtg-detail-box" style="max-width:1180px;width:95vw;display:flex;flex-direction:column;max-height:92vh">
    <div class="modal-head">
      <h3 id="mtg-detail-title">รายงานการประชุม</h3>
      <button class="modal-close" onclick="window._mtgCloseDetail()">✕</button>
    </div>
    <div style="display:flex;gap:0;flex:1;min-height:0;overflow:hidden">
      <div class="modal-body" style="flex:0 0 480px;width:480px;overflow-y:auto">
        <div class="form-row" style="margin-bottom:14px">
          <div class="form-group">
            <label>ครั้งที่</label>
            <input class="form-control" id="mtg-no" oninput="window._mtgLiveInput()" onblur="window._mtgSaveMeta()">
          </div>
          <div class="form-group">
            <label>วันที่ประชุม</label>
            <input type="date" class="form-control" id="mtg-date" oninput="window._mtgLiveInput()" onblur="window._mtgSaveMeta()">
          </div>
        </div>
        <div class="form-group" style="margin-bottom:14px">
          <label>สถานที่ประชุม</label>
          <input class="form-control" id="mtg-location" oninput="window._mtgLiveInput()" onblur="window._mtgSaveMeta()">
        </div>
        <div class="form-group" style="margin-bottom:18px">
          <label>ผู้เข้าร่วมประชุม (บรรทัดละ 1 คน)</label>
          <textarea class="form-control" id="mtg-attendees" rows="3" oninput="window._mtgLiveInput()" onblur="window._mtgSaveMeta()"></textarea>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h4 style="margin:0;font-size:14px;color:#1a3c5e">หัวข้อที่ประชุม / มติที่ประชุม</h4>
          <button class="btn btn-sm btn-outline" onclick="window._mtgAddTopic()">+ เพิ่มหัวข้อ</button>
        </div>
        <div id="mtg-topics-list" style="margin-bottom:20px"></div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h4 style="margin:0;font-size:14px;color:#1a3c5e">Action Item (ติดตามข้ามการประชุม)</h4>
        </div>
        <div id="mtg-action-open" style="margin-bottom:10px"></div>
        <div id="mtg-action-add" style="margin-bottom:16px"></div>
        <div id="mtg-action-done-wrap"></div>
      </div>
      <div style="flex:1;min-width:0;border-left:1px solid #e2e8f0;overflow-y:auto;background:#f7f9fc;padding:20px">
        <div style="font-size:12px;color:#888;margin-bottom:10px">— ตัวอย่างรายงาน (อัปเดตอัตโนมัติ) —</div>
        <div id="mtg-live-preview" style="max-width:560px;margin:0 auto"></div>
      </div>
    </div>
    <div class="modal-foot" style="justify-content:space-between">
      <div style="font-size:12px;color:#888">บันทึกอัตโนมัติเมื่อแก้ไข</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" onclick="window._mtgCloseDetail()">ปิด</button>
        <button class="btn btn-success" onclick="window._mtgPrintCurrent()">🖨 พิมพ์รายงานการประชุม</button>
      </div>
    </div>
  </div>
</div>`);
}
window._mtgPrintCurrent = function () { if (currentMeeting) window._mtgPrint(currentMeeting.id); };

window._mtgLiveInput = function () {
  if (!currentMeeting) return;
  currentMeeting.meeting_no  = document.getElementById('mtg-no').value;
  currentMeeting.meeting_date = document.getElementById('mtg-date').value;
  currentMeeting.location    = document.getElementById('mtg-location').value;
  currentMeeting.attendees   = document.getElementById('mtg-attendees').value;
  renderLivePreview();
};

function topicRowHTML(topic, idx) {
  return `
  <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:8px">
    <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px">
      <input class="form-control" style="flex:1;font-weight:600" value="${escH(topic.title || '')}"
        placeholder="หัวข้อที่ ${idx + 1}"
        oninput="window._mtgTopicLiveInput(${idx},'title',this.value)"
        onblur="window._mtgTopicEdit(${idx},'title',this.value)">
      <button class="btn-del-row" title="ลบหัวข้อ" onclick="window._mtgTopicRemove(${idx})">✕</button>
    </div>
    <textarea class="form-control" rows="2" placeholder="รายละเอียด / มติที่ประชุม"
      oninput="window._mtgTopicLiveInput(${idx},'notes',this.value)"
      onblur="window._mtgTopicEdit(${idx},'notes',this.value)">${escH(topic.notes || '')}</textarea>
  </div>`;
}
function renderTopicsList() {
  const el = document.getElementById('mtg-topics-list');
  if (!el || !currentMeeting) return;
  const topics = currentMeeting.topics || [];
  el.innerHTML = topics.length
    ? topics.map((t, i) => topicRowHTML(t, i)).join('')
    : '<div style="color:#94a3b8;text-align:center;padding:14px;border:1px dashed #e2e8f0;border-radius:8px">ยังไม่มีหัวข้อ — กด "+ เพิ่มหัวข้อ"</div>';
}

window._mtgAddTopic = async function () {
  if (!currentMeeting) return;
  const topics = [...(currentMeeting.topics || []), { title: '', notes: '' }];
  await saveTopics(topics);
  renderTopicsList();
  renderLivePreview();
};
window._mtgTopicRemove = async function (idx) {
  if (!currentMeeting) return;
  const topics = (currentMeeting.topics || []).filter((_, i) => i !== idx);
  await saveTopics(topics);
  renderTopicsList();
  renderLivePreview();
};
window._mtgTopicEdit = async function (idx, field, value) {
  if (!currentMeeting) return;
  const topics = [...(currentMeeting.topics || [])];
  if (!topics[idx]) return;
  topics[idx] = { ...topics[idx], [field]: value };
  await saveTopics(topics);
};
window._mtgTopicLiveInput = function (idx, field, value) {
  if (!currentMeeting) return;
  const topics = [...(currentMeeting.topics || [])];
  if (!topics[idx]) return;
  topics[idx] = { ...topics[idx], [field]: value };
  currentMeeting.topics = topics;
  renderLivePreview();
};
async function saveTopics(topics) {
  try {
    const { error } = await sb.from('meeting_reports').update({ topics, updated_at: new Date().toISOString() }).eq('id', currentMeeting.id);
    if (error) throw error;
    currentMeeting.topics = topics;
    const idx = meetings.findIndex(m => m.id === currentMeeting.id);
    if (idx > -1) meetings[idx].topics = topics;
  } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message); }
}

// ── Action items ────────────────────────────────────────────
function actionOpenRowHTML(item) {
  const meetingLabel = item.origin_meeting_id === currentMeeting.id
    ? 'จากการประชุมนี้'
    : (meetings.find(m => m.id === item.origin_meeting_id)?.meeting_no
        ? `จากครั้งที่ ${escH(meetings.find(m => m.id === item.origin_meeting_id).meeting_no)}`
        : '');
  return `
  <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:8px;background:${isOverdue(item)?'#fef2f2':'#f7fafc'};margin-bottom:6px">
    <div style="flex:1">
      <input class="form-control" style="margin-bottom:4px" value="${escH(item.issue)}"
        oninput="window._mtgActionLiveInput('${item.id}','issue',this.value)"
        onblur="window._mtgActionEdit('${item.id}','issue',this.value)">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <input class="form-control" style="width:150px;font-size:12px" placeholder="ผู้รับผิดชอบ" value="${escH(item.responsible || '')}"
          oninput="window._mtgActionLiveInput('${item.id}','responsible',this.value)"
          onblur="window._mtgActionEdit('${item.id}','responsible',this.value)">
        <input type="date" class="form-control" style="width:150px;font-size:12px" value="${item.due_date || ''}"
          oninput="window._mtgActionLiveInput('${item.id}','due_date',this.value)"
          onblur="window._mtgActionEdit('${item.id}','due_date',this.value)">
        ${itemStatusBadge(item)}
        <span style="font-size:11px;color:#94a3b8;align-self:center">${meetingLabel}</span>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px">
      <button class="btn btn-sm btn-outline" onclick="window._mtgActionSetStatus('${item.id}','done')">✓ เสร็จ</button>
      <button class="btn-del-row" title="ลบ" onclick="window._mtgActionDelete('${item.id}')">✕</button>
    </div>
  </div>`;
}
function actionDoneRowHTML(item) {
  return `
  <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;background:#f7fafc;margin-bottom:4px;opacity:.75">
    <div style="flex:1;font-size:13px;color:#334155;text-decoration:line-through">${escH(item.issue)}</div>
    <div style="font-size:11px;color:#94a3b8">${escH(item.responsible || '')}</div>
    ${itemStatusBadge(item)}
    <button class="btn btn-sm btn-outline" onclick="window._mtgActionSetStatus('${item.id}','pending')">เปิดใหม่</button>
  </div>`;
}
function renderActionItems() {
  const openEl = document.getElementById('mtg-action-open');
  const addEl  = document.getElementById('mtg-action-add');
  const doneWrapEl = document.getElementById('mtg-action-done-wrap');
  if (!openEl || !currentMeeting) return;

  const open = currentActionItems.filter(i => i.status === 'pending')
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);
  const done = currentActionItems.filter(i => i.status === 'done');

  openEl.innerHTML = open.length
    ? open.map(actionOpenRowHTML).join('')
    : '<div style="color:#94a3b8;text-align:center;padding:10px;border:1px dashed #e2e8f0;border-radius:8px;font-size:13px">ไม่มีรายการค้าง</div>';

  addEl.innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;border-top:1px dashed #e2e8f0;padding-top:10px">
      <input class="form-control" style="flex:1;min-width:180px" id="mtg-new-action-issue" placeholder="รายการ / ปัญหาที่ต้องติดตาม">
      <input class="form-control" style="width:150px" id="mtg-new-action-resp" placeholder="ผู้รับผิดชอบ">
      <input type="date" class="form-control" style="width:150px" id="mtg-new-action-due">
      <button class="btn btn-sm btn-primary" onclick="window._mtgActionAdd()">+ เพิ่มรายการ</button>
    </div>`;

  doneWrapEl.innerHTML = done.length ? `
    <details style="margin-top:10px">
      <summary style="cursor:pointer;font-size:13px;color:#64748b">ประวัติที่เสร็จแล้ว (${done.length})</summary>
      <div style="margin-top:8px">${done.map(actionDoneRowHTML).join('')}</div>
    </details>` : '';
}

window._mtgActionAdd = async function () {
  if (!currentMeeting) return;
  const issue = document.getElementById('mtg-new-action-issue').value.trim();
  const responsible = document.getElementById('mtg-new-action-resp').value.trim();
  const due_date = document.getElementById('mtg-new-action-due').value || null;
  if (!issue) return toast('กรุณากรอกรายการที่ต้องติดตาม');
  try {
    const { data, error } = await sb.from('meeting_action_items').insert({
      job_id: currentMeeting.job_id, origin_meeting_id: currentMeeting.id,
      issue, responsible, due_date, created_by: window._mtgCurrentUserId,
    }).select().single();
    if (error) throw error;
    currentActionItems.push(data);
    actionItemsByJob[currentMeeting.job_id] = currentActionItems;
    renderActionItems();
    renderLivePreview();
    renderTab();
    toast('เพิ่ม Action Item แล้ว');
  } catch (e) { toast('เกิดข้อผิดพลาด: ' + e.message); }
};

window._mtgActionEdit = async function (id, field, value) {
  const item = currentActionItems.find(i => i.id === id);
  if (!item || item[field] === value) return;
  try {
    const payload = { [field]: value || null, updated_at: new Date().toISOString() };
    const { error } = await sb.from('meeting_action_items').update(payload).eq('id', id);
    if (error) throw error;
    item[field] = value || null;
    renderActionItems();
  } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message); }
};

window._mtgActionLiveInput = function (id, field, value) {
  const item = currentActionItems.find(i => i.id === id);
  if (!item) return;
  item[field] = value;
  renderLivePreview();
};

window._mtgActionSetStatus = async function (id, status) {
  const item = currentActionItems.find(i => i.id === id);
  if (!item) return;
  try {
    const payload = { status, resolved_at: status === 'done' ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
    const { error } = await sb.from('meeting_action_items').update(payload).eq('id', id);
    if (error) throw error;
    Object.assign(item, payload);
    renderActionItems();
    renderLivePreview();
    renderTab();
  } catch (e) { toast('เกิดข้อผิดพลาด: ' + e.message); }
};

window._mtgActionDelete = async function (id) {
  const ok = await window.appConfirm({ title: 'ลบ Action Item', message: 'ต้องการลบรายการนี้ใช่ไหม?', okText: 'ลบ', okColor: '#e53e3e' });
  if (!ok) return;
  try {
    const { error } = await sb.from('meeting_action_items').delete().eq('id', id);
    if (error) throw error;
    currentActionItems = currentActionItems.filter(i => i.id !== id);
    actionItemsByJob[currentMeeting.job_id] = currentActionItems;
    renderActionItems();
    renderLivePreview();
    renderTab();
    toast('ลบแล้ว');
  } catch (e) { toast('เกิดข้อผิดพลาด: ' + e.message); }
};

// ── Open / close / save meta ──────────────────────────────────
window._mtgOpenMeeting = async function (meetingId) {
  injectDetailModal();
  currentMeeting = meetings.find(m => m.id === meetingId);
  if (!currentMeeting) return;
  currentActionItems = actionItemsByJob[currentMeeting.job_id] || [];

  document.getElementById('mtg-detail-title').textContent =
    `${currentMeeting.jobs?.job_name || ''} — ครั้งที่ ${currentMeeting.meeting_no || '—'}`;
  document.getElementById('mtg-no').value = currentMeeting.meeting_no || '';
  document.getElementById('mtg-date').value = currentMeeting.meeting_date || '';
  document.getElementById('mtg-location').value = currentMeeting.location || '';
  document.getElementById('mtg-attendees').value = currentMeeting.attendees || '';

  renderTopicsList();
  renderActionItems();
  renderLivePreview();
  document.getElementById('modal-mtg-detail').classList.add('open');
};
window._mtgCloseDetail = function () {
  document.getElementById('modal-mtg-detail')?.classList.remove('open');
  currentMeeting = null;
  currentActionItems = [];
  renderTab();
};

window._mtgSaveMeta = async function () {
  if (!currentMeeting) return;
  const meeting_no = document.getElementById('mtg-no').value.trim();
  const meeting_date = document.getElementById('mtg-date').value;
  const location = document.getElementById('mtg-location').value.trim();
  const attendees = document.getElementById('mtg-attendees').value.trim();
  if (meeting_no === (currentMeeting.meeting_no||'') && meeting_date === currentMeeting.meeting_date
      && location === (currentMeeting.location||'') && attendees === (currentMeeting.attendees||'')) return;
  try {
    const { error } = await sb.from('meeting_reports').update({
      meeting_no, meeting_date, location, attendees, updated_at: new Date().toISOString(),
    }).eq('id', currentMeeting.id);
    if (error) throw error;
    Object.assign(currentMeeting, { meeting_no, meeting_date, location, attendees });
    const idx = meetings.findIndex(m => m.id === currentMeeting.id);
    if (idx > -1) Object.assign(meetings[idx], { meeting_no, meeting_date, location, attendees });
    document.getElementById('mtg-detail-title').textContent =
      `${currentMeeting.jobs?.job_name || ''} — ครั้งที่ ${currentMeeting.meeting_no || '—'}`;
  } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message); }
};

// ── Print / preview (both render the same document content) ───
function buildMeetingDocContentHTML(meeting, items) {
  const attendeeLines = (meeting.attendees || '').split('\n').map(s => s.trim()).filter(Boolean);
  const topics = meeting.topics || [];
  const open = items.filter(i => i.status === 'pending');
  const done = items.filter(i => i.status === 'done');
  const orderedItems = [...open, ...done];

  return `
    <div style="text-align:center;font-size:16pt;font-weight:700;margin-bottom:4pt">รายงานการประชุม</div>
    <div style="text-align:center;font-size:11pt;color:#64748b;margin-bottom:14pt">${escH(meeting.jobs?.job_name || '')} ${meeting.jobs?.job_code ? '(' + escH(meeting.jobs.job_code) + ')' : ''}</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14pt;font-size:10.5pt">
      <tr><td style="width:25%;padding:3pt 0">ครั้งที่</td><td style="padding:3pt 0">${escH(meeting.meeting_no || '—')}</td>
          <td style="width:20%;padding:3pt 0">วันที่ประชุม</td><td style="padding:3pt 0">${fmtDateTH(meeting.meeting_date)}</td></tr>
      <tr><td style="padding:3pt 0">สถานที่</td><td colspan="3" style="padding:3pt 0">${escH(meeting.location || '—')}</td></tr>
    </table>

    <div style="font-size:11pt;font-weight:700;margin-bottom:6pt;border-bottom:1.5px solid #1a3c5e;padding-bottom:4pt">ผู้เข้าร่วมประชุม</div>
    <div style="font-size:10pt;margin-bottom:14pt;line-height:1.8">
      ${attendeeLines.length ? attendeeLines.map((a,i) => `${i+1}. ${escH(a)}`).join('<br>') : '—'}
    </div>

    <div style="font-size:11pt;font-weight:700;margin-bottom:6pt;border-bottom:1.5px solid #1a3c5e;padding-bottom:4pt">หัวข้อที่ประชุม / มติที่ประชุม</div>
    <div style="font-size:10pt;margin-bottom:14pt;line-height:1.7">
      ${topics.length ? topics.map((t,i) => `
        <div style="margin-bottom:8pt">
          <div style="font-weight:700">${i+1}. ${escH(t.title || '(ไม่มีชื่อหัวข้อ)')}</div>
          ${t.notes ? `<div style="padding-left:14pt;color:#334155">${escH(t.notes).replace(/\n/g,'<br>')}</div>` : ''}
        </div>`).join('') : '<span style="color:#94a3b8">— ไม่มีหัวข้อ —</span>'}
    </div>

    <div style="font-size:11pt;font-weight:700;margin-bottom:6pt;border-bottom:1.5px solid #1a3c5e;padding-bottom:4pt">Action Item</div>
    <table class="print-table" style="margin-bottom:20pt">
      <thead><tr><th style="width:5%">#</th><th>รายการ</th><th style="width:20%">ผู้รับผิดชอบ</th><th style="width:15%">กำหนดเสร็จ</th><th style="width:15%">สถานะ</th></tr></thead>
      <tbody>
        ${orderedItems.length ? orderedItems.map((it,i) => `
          <tr>
            <td>${i+1}</td>
            <td>${escH(it.issue)}</td>
            <td>${escH(it.responsible || '—')}</td>
            <td>${it.due_date ? fmtDateTH(it.due_date) : '—'}</td>
            <td>${it.status === 'done' ? 'เสร็จแล้ว' : (isOverdue(it) ? 'เกินกำหนด' : 'ค้าง')}</td>
          </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;color:#94a3b8">— ไม่มี Action Item —</td></tr>`}
      </tbody>
    </table>

    <table style="width:100%;margin-top:30pt;font-size:10pt;text-align:center">
      <tr>
        <td style="width:50%">………………………………………<br>( &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; )<br><strong>ผู้บันทึกการประชุม</strong></td>
        <td style="width:50%">………………………………………<br>( &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; )<br><strong>ผู้ตรวจสอบ / ประธานการประชุม</strong></td>
      </tr>
    </table>`;
}

function buildMeetingPrintHTML(meeting, items) {
  return `<div style="padding:16mm;background:#fff;width:210mm;min-height:297mm;box-sizing:border-box;font-family:Sarabun,sans-serif;color:#1a3c5e">
    ${buildMeetingDocContentHTML(meeting, items)}
  </div>`;
}

// Live preview panel (right side of the detail modal) — same content as the
// print output, shrunk to fit the panel with `zoom` so it reflows like a
// real page instead of leaving dead whitespace behind a CSS transform.
function renderLivePreview() {
  const el = document.getElementById('mtg-live-preview');
  if (!el || !currentMeeting) return;
  const content = buildMeetingDocContentHTML(currentMeeting, currentActionItems);
  el.innerHTML = `
    <div style="background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.06);overflow:hidden">
      <div style="width:794px;zoom:.7;padding:16mm;box-sizing:border-box;font-family:Sarabun,sans-serif;color:#1a3c5e">
        ${content}
      </div>
    </div>`;
}

window._mtgPrint = function (meetingId) {
  const meeting = meetings.find(m => m.id === meetingId) || currentMeeting;
  if (!meeting) return;
  const items = actionItemsByJob[meeting.job_id] || [];
  const html = buildMeetingPrintHTML(meeting, items);
  const styles = Array.from(document.styleSheets).map(ss => {
    try { return Array.from(ss.cssRules).map(r => r.cssText).join(' '); } catch (e) { return ''; }
  }).join(' ');
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>รายงานการประชุม ${escH(meeting.meeting_no || '')}</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${styles}</style></head><body>${html}</body></html>`);
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
};
