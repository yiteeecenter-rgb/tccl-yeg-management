import { sb } from './supabase.js';
import { doTerminationPrint, buildTerminationPrintHTML } from './termination-print.js';

// inject preview CSS so .tk-ft border rules match print
(function injectTkPreviewCSS() {
  if (document.getElementById('_tk-preview-style')) return;
  const s = document.createElement('style');
  s.id = '_tk-preview-style';
  s.textContent = `
    .tk-ft td:first-child, .tk-ft th:first-child { border-left: none !important; }
    .tk-ft td:last-child,  .tk-ft th:last-child  { border-right: none !important; }

    /* ── Form font consistency ── */
    #modal-termination .modal-body label {
      font-size: 11px !important;
    }
    #modal-termination .modal-body .form-control,
    #modal-termination .modal-body input.form-control,
    #modal-termination .modal-body select.form-control {
      font-size: 13px !important;
      height: auto !important;
      padding: 7px 10px !important;
    }
    /* section card sub-titles (Installation by / 2.1 / etc.) */
    #modal-termination .modal-body [style*="font-size:10px"],
    #modal-termination .modal-body [style*="font-size:9px"] {
      font-size: 11px !important;
    }
    /* section main labels (ชื่อโครงการ, บริษัท, etc.) */
    #modal-termination .modal-body [style*="font-size:11px"][style*="font-weight:700"]:not(button):not(span.badge) {
      font-size: 12px !important;
    }
    /* measurement table inputs */
    #modal-termination .modal-body table input[type=text] {
      font-size: 12px !important;
      padding: 4px 5px !important;
    }
    /* add-feeder button pop animation */
    @keyframes tk-pop {
      0%   { transform: scale(1); }
      40%  { transform: scale(.93); }
      70%  { transform: scale(1.04); }
      100% { transform: scale(1); }
    }
    .tk-btn-pop { animation: tk-pop .28s ease; }
  `;
  document.head.appendChild(s);
}());

const TABLE  = 'termination_records';
const BUCKET = 'termination-photos';

let records       = [];
let editId        = null;
let formSessionId = null;
let feeders       = [];
let jobsCache     = [];
let kitRows       = []; // raw rows from kit_catalogue

function buildKitData(rows) {
  const d = {};
  rows.filter(r => r.is_active).forEach(r => {
    if (!d[r.brand]) d[r.brand] = {};
    if (!d[r.brand][r.type]) d[r.brand][r.type] = [];
    d[r.brand][r.type].push(r.model);
  });
  return d;
}
function getKitData() { return buildKitData(kitRows); }
const photoFiles  = new Map(); // key: `${localId}-${phase}-${key}` → File

// ── Supabase CRUD ─────────────────────────────────────────────
async function listRecords() {
  const { data, error } = await sb.from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function saveRecord(rec) {
  if (rec.id) {
    const { id, profiles, jobs: _j, ...rest } = rec;
    const { data, error } = await sb.from(TABLE).update(rest).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await sb.from(TABLE).insert(rec).select().single();
  if (error) throw error;
  return data;
}

async function deleteRecord(id) {
  const { error } = await sb.from(TABLE).delete().eq('id', id);
  if (error) throw error;
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

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function getJobs() { return jobsCache; }

// ── Photo upload helpers ───────────────────────────────────────
window._tkPhotoChange = function (fi, phase, key, input) {
  if (!input.files?.[0]) return;
  const file  = input.files[0];
  const lid   = feeders[fi]?._localId;
  if (!lid) return;
  photoFiles.set(`${lid}-${phase}-${key}`, file);
  const thumb = document.getElementById(`tkf-thumb-${fi}-${phase}-${key}`);
  if (thumb) {
    const url = URL.createObjectURL(file);
    thumb.style.backgroundImage = `url(${url})`;
    thumb.style.backgroundSize  = 'cover';
    thumb.style.backgroundPosition = 'center';
    thumb.innerHTML = '';
  }
};

window._tkPhotoClear = function (fi, phase, key, e) {
  e.stopPropagation();
  const lid = feeders[fi]?._localId;
  if (lid) photoFiles.delete(`${lid}-${phase}-${key}`);
  // also clear stored URL
  if (feeders[fi]?.measurements?.[phase]?.photos) {
    feeders[fi].measurements[phase].photos[key] = null;
  }
  const thumb = document.getElementById(`tkf-thumb-${fi}-${phase}-${key}`);
  if (thumb) {
    thumb.style.backgroundImage = '';
    thumb.innerHTML = '<span style="color:#94a3b8;font-size:18px;pointer-events:none">+</span>';
  }
  const input = document.getElementById(`tkf-file-${fi}-${phase}-${key}`);
  if (input) input.value = '';
};

async function uploadPendingPhotos() {
  for (let fi = 0; fi < feeders.length; fi++) {
    const lid = feeders[fi]._localId;
    for (const phase of ['A','B','C']) {
      for (const key of ['L','S','dia','K']) {
        const file = photoFiles.get(`${lid}-${phase}-${key}`);
        if (!file) continue;
        const ext  = file.name.split('.').pop() || 'jpg';
        const path = `${formSessionId}/${fi}/${phase}_${key}.${ext}`;
        const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: true });
        if (error) throw new Error(`อัพโหลดรูปล้มเหลว: ${error.message}`);
        const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(path);
        feeders[fi].measurements ??= {};
        feeders[fi].measurements[phase] ??= {};
        feeders[fi].measurements[phase].photos ??= {};
        feeders[fi].measurements[phase].photos[key] = urlData.publicUrl;
      }
    }
  }
}

// ── Feeder card HTML ──────────────────────────────────────────
function feederCardHTML(idx, f = {}) {
  const phases    = ['A', 'B', 'C'];
  const measItems = [
    { key: 'L',   label: 'Remove Oversheath (L)' },
    { key: 'S',   label: 'Insulation Screen (S)' },
    { key: 'dia', label: 'Diameter over Insulation' },
    { key: 'K',   label: 'Conductor Length (K)' },
  ];
  const m = f.measurements || {};

  const phaseThemes = {
    A: { bg:'#f8fafc', border:'#64748b', text:'#334155', sub:'#e2e8f0', accent:'#475569' },
    B: { bg:'#f8fafc', border:'#64748b', text:'#334155', sub:'#e2e8f0', accent:'#475569' },
    C: { bg:'#f8fafc', border:'#64748b', text:'#334155', sub:'#e2e8f0', accent:'#475569' },
  };

  function phaseCell(phase, item) {
    const t        = phaseThemes[phase];
    const pm       = m[phase] || {};
    const val      = escH(pm[item.key] || '');
    const photoUrl = pm.photos?.[item.key] || '';
    const lid      = f._localId || '';
    const hasPFile = photoFiles.has(`${lid}-${phase}-${item.key}`);
    const hasPhoto = photoUrl || hasPFile;
    const bgStyle  = photoUrl
      ? `background-image:url(${escH(photoUrl)});background-size:cover;background-position:center;`
      : '';
    const thumbContent = hasPhoto
      ? `<div onclick="window._tkPhotoClear(${idx},'${phase}','${item.key}',event)"
             style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.55);color:#fff;
                    border-radius:50%;width:14px;height:14px;font-size:9px;line-height:14px;
                    text-align:center;cursor:pointer;z-index:1">✕</div>`
      : `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="${t.border}" stroke-width="2.2" style="opacity:.6">
           <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
           <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
         </svg>`;
    return `
      <td style="padding:4px 5px;vertical-align:middle">
        <input type="text" id="tkf-f${idx}-m-${phase}-${item.key}"
          value="${val}"
          style="width:100%;min-width:48px;border:1.5px solid #e2e8f0;border-radius:7px;padding:4px 5px;
                 font-size:11px;text-align:center;font-family:inherit;box-sizing:border-box;
                 background:#fff;outline:none;transition:border-color .15s,box-shadow .15s"
          onfocus="this.style.borderColor='${t.border}';this.style.boxShadow='0 0 0 3px ${t.border}22'"
          onblur="this.style.borderColor='#e2e8f0';this.style.boxShadow='none'"
          oninput="window._tkLivePreview()">
      </td>
      <td style="padding:4px 5px;text-align:center;vertical-align:middle">
        <div style="position:relative;width:38px;height:38px;
                    border:1.5px ${hasPhoto ? 'solid' : 'dashed'} ${hasPhoto ? t.border : '#d1d5db'};
                    border-radius:8px;cursor:pointer;overflow:hidden;margin:0 auto;
                    display:flex;align-items:center;justify-content:center;
                    background:${hasPhoto ? 'transparent' : t.bg};${bgStyle}
                    transition:transform .12s,border-color .15s"
             id="tkf-thumb-${idx}-${phase}-${item.key}"
             onclick="document.getElementById('tkf-file-${idx}-${phase}-${item.key}').click()"
             onmouseover="this.style.transform='scale(1.08)'"
             onmouseout="this.style.transform='scale(1)'"
             title="คลิกเพื่ออัพโหลดรูป">
          ${thumbContent}
        </div>
        <input type="file" accept="image/*" capture="environment"
               id="tkf-file-${idx}-${phase}-${item.key}"
               style="display:none"
               onchange="window._tkPhotoChange(${idx},'${phase}','${item.key}',this)">
      </td>`;
  }

  function buildMeasTable() {
    const phaseHeaderCols = phases.map(ph => {
      return `<th colspan="2" style="padding:7px 8px;font-size:10px;font-weight:700;color:#374151;
              background:#f1f5f9;border-bottom:2px solid #94a3b8;text-align:center;letter-spacing:.3px">
        Phase ${ph}
      </th>`;
    }).join('');
    const subHeaderCols = phases.map(ph => {
      const t = phaseThemes[ph];
      return `<th style="padding:4px 5px;font-size:9px;color:${t.text};opacity:.75;font-weight:600;
              text-align:center;background:${t.bg};border-bottom:1px solid ${t.sub}">mm</th>
       <th style="padding:4px 5px;font-size:9px;color:${t.text};opacity:.75;font-weight:600;
              text-align:center;background:${t.bg};border-bottom:1px solid ${t.sub}">รูป</th>`;
    }).join('');
    const dataRows = measItems.map((item, ri) => {
      const phaseCells = phases.map(ph => phaseCell(ph, item)).join('');
      return `<tr style="background:${ri % 2 === 0 ? '#fff' : '#f9fafb'};transition:background .1s"
               onmouseover="this.style.background='#f1f5f9'"
               onmouseout="this.style.background='${ri % 2 === 0 ? '#fff' : '#f9fafb'}'">
        <td style="padding:6px 10px;font-size:10.5px;color:#374151;white-space:nowrap;font-weight:500;
                   border-right:1px solid #f0f0f0">${escH(item.label)}</td>
        ${phaseCells}
      </tr>`;
    }).join('');
    return `
    <div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.06)">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="padding:7px 10px;background:#f8fafc;border-bottom:1px solid #e5e7eb;width:155px"></th>
            ${phaseHeaderCols}
          </tr>
          <tr>
            <th style="padding:4px 10px;background:#f8fafc;font-size:9px;color:#9ca3af;font-weight:600;
                    border-bottom:1px solid #e5e7eb;text-align:left">รายการ</th>
            ${subHeaderCols}
          </tr>
        </thead>
        <tbody>${dataRows}</tbody>
      </table>
    </div>`;
  }

  const circuit  = escH(f.circuit_designation || `วงจรที่ ${idx + 1}`);
  const kitType  = f.kit_type || '';
  // color theme by type
  const typeTheme = kitType === 'Outdoor'
    ? { bg:'#f0fdf4', border:'#22c55e', text:'#15803d', badgeBg:'#dcfce7', badgeColor:'#15803d', badgeBorder:'#86efac' }
    : kitType === 'Indoor'
    ? { bg:'#f0f4ff', border:'#4f7aeb', text:'#1e40af', badgeBg:'#dbeafe', badgeColor:'#1d4ed8', badgeBorder:'#93c5fd' }
    : { bg:'#f8fafc', border:'#94a3b8', text:'#475569', badgeBg:'#f1f5f9', badgeColor:'#64748b', badgeBorder:'#cbd5e1' };

  const pos = f.install_position ? escH(f.install_position) : '';
  const subParts = [pos, kitType ? `${escH(kitType)} Termination Kit` : ''].filter(Boolean);
  const subSuffix = subParts.length ? `  <span style="color:${typeTheme.border};font-weight:500">(${subParts.join(' - ')})</span>` : '';
  return `
<div id="tk-feeder-${idx}"
     draggable="true"
     data-feeder-idx="${idx}"
     style="border:1.5px solid #e2e8f0;border-radius:14px;margin-bottom:8px;overflow:hidden;
            box-shadow:0 2px 10px rgba(0,0,0,.06);transition:opacity .2s,transform .2s"
     ondragstart="window._tkDragStart(event,${idx})"
     ondragover="window._tkDragOver(event,${idx})"
     ondragleave="window._tkDragLeave(event,${idx})"
     ondrop="window._tkDrop(event,${idx})"
     ondragend="window._tkDragEnd(event)">

  <!-- Header (click to toggle) -->
  <div id="tk-feeder-${idx}-header"
       style="background:${typeTheme.bg};border-bottom:1px solid ${typeTheme.border}33;border-left:4px solid ${typeTheme.border};
              padding:8px 14px;display:flex;align-items:center;justify-content:space-between;
              cursor:pointer;user-select:none"
       onclick="window._tkToggleFeeder(${idx})">
    <div style="display:flex;align-items:center;gap:8px">
      <!-- drag handle -->
      <div style="width:20px;height:20px;border-radius:5px;background:rgba(0,0,0,.06);
                  display:flex;align-items:center;justify-content:center;cursor:grab;flex-shrink:0"
           title="ลากเพื่อเรียงลำดับ"
           onclick="event.stopPropagation()">
        <svg width="11" height="11" fill="${typeTheme.border}" viewBox="0 0 24 24">
          <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
          <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
          <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
        </svg>
      </div>
      <div id="tk-feeder-${idx}-subtitle" style="display:flex;align-items:center;flex-wrap:wrap">
        <span style="font-size:10.5px;font-weight:500;color:${typeTheme.text};letter-spacing:.1px">${circuit}${subSuffix}</span>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <!-- chevron -->
      <div id="tk-feeder-${idx}-chevron"
           style="width:22px;height:22px;border-radius:5px;background:rgba(79,122,235,.1);
                  display:flex;align-items:center;justify-content:center;
                  transition:transform .25s">
        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#4f7aeb" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </div>
      <button onclick="event.stopPropagation();window._tkRemoveFeeder(${idx})"
        style="background:transparent;border:1px solid #fca5a5;
               color:#dc2626;cursor:pointer;font-size:11px;font-weight:500;
               padding:3px 10px;border-radius:5px;display:flex;align-items:center;gap:3px;
               transition:background .15s"
        onmouseover="this.style.background='#fee2e2'"
        onmouseout="this.style.background='transparent'">
        <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
        ลบ
      </button>
    </div>
  </div>

  <!-- Collapsible body (collapsed by default) -->
  <div id="tk-feeder-${idx}-body" style="display:none">

  <!-- 2.1 ข้อมูลสายไฟและหัวสาย -->
  <div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;background:#fff">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:7px">
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#64748b" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
        </svg>
        <span style="font-size:12px;font-weight:600;color:#374151">ข้อมูลสายไฟและหัวสาย</span>
      </div>
      <button type="button" onclick="window._openKitMgr()"
        style="background:#7c3aed;color:#fff;border:none;
               border-radius:7px;padding:4px 12px;cursor:pointer;font-size:10px;font-weight:600;
               display:flex;align-items:center;gap:4px">
        <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
        จัดการ Kit
      </button>
    </div>
    <div style="padding:0 0 10px 0">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;
                        letter-spacing:.4px;display:block;margin-bottom:3px">Circuit designation</label>
          <input id="tkf-f${idx}-circuit" class="form-control"
            value="${escH(f.circuit_designation || '')}"
            placeholder="เช่น SWG.TC.1" oninput="window._tkLivePreview()"
            style="border-radius:7px;font-size:11px">
        </div>
        <div>
          <label style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;
                        letter-spacing:.4px;display:block;margin-bottom:3px">ตำแหน่งติดตั้งหัวสาย</label>
          <select id="tkf-f${idx}-install-pos" class="form-control"
                  onchange="window._tkPosChange(${idx},this.value);window._tkLivePreview()"
                  style="border-radius:7px;font-size:11px">
            <option value="">-- เลือก --</option>
            ${['Switchgear','Riser Pole','Capacitor Bank','Station Service Transformer','Power Transformer','Ring Main Unit','Cable Junction Box','อื่นๆ']
              .map(v => `<option value="${v}" ${f.install_position===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;
                        letter-spacing:.4px;display:block;margin-bottom:3px">แรงดัน (kV)</label>
          <select id="tkf-f${idx}-voltage" class="form-control"
                  onchange="window._tkLivePreview()"
                  style="border-radius:7px;font-size:11px">
            <option value="22" ${(f.voltage||'33')==='22'?'selected':''}>22 kV</option>
            <option value="33" ${(f.voltage||'33')!=='22'?'selected':''}>33 kV</option>
          </select>
        </div>
        <div>
          <label style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;
                        letter-spacing:.4px;display:block;margin-bottom:3px">ขนาดสาย (Sq.mm.)</label>
          <select id="tkf-f${idx}-cable-size" class="form-control"
                  onchange="window._tkLivePreview()"
                  style="border-radius:7px;font-size:11px">
            <option value="">-- เลือก --</option>
            ${['95','240','400','500'].map(v => `<option value="${v}" ${f.cable_size===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <div style="padding-top:4px;border-top:1px solid #f1f5f9">
      <div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;
                  letter-spacing:.4px;margin-bottom:8px">Termination Kit</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div>
          <label style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;
                        letter-spacing:.4px;display:block;margin-bottom:3px">ยี่ห้อ</label>
          <select id="tkf-f${idx}-kit-brand" class="form-control"
                  onchange="window._tkKitBrandChange(${idx})"
                  style="border-radius:7px;font-size:11px">
            <option value="">-- เลือก --</option>
            ${Object.keys(getKitData()).map(b =>
              `<option value="${b}" ${f.kit_brand===b?'selected':''}>${b}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;
                        letter-spacing:.4px;display:block;margin-bottom:3px">ประเภท</label>
          <select id="tkf-f${idx}-kit-type" class="form-control"
                  onchange="window._tkKitTypeChange(${idx})"
                  style="border-radius:7px;font-size:11px">
            <option value="">-- เลือก --</option>
            <option value="Indoor" ${f.kit_type==='Indoor'?'selected':''}>Indoor</option>
            <option value="Outdoor" ${f.kit_type==='Outdoor'?'selected':''}>Outdoor</option>
          </select>
        </div>
        <div>
          <label style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;
                        letter-spacing:.4px;display:block;margin-bottom:3px">รุ่น / โมเดล</label>
          <select id="tkf-f${idx}-kit-model" class="form-control"
                  onchange="window._tkKitModelChange(${idx})"
                  style="border-radius:7px;font-size:11px">
            <option value="">-- เลือก --</option>
            ${f.kit_brand && f.kit_type && getKitData()[f.kit_brand]?.[f.kit_type]
              ? getKitData()[f.kit_brand][f.kit_type].map(v =>
                  `<option value="${v}" ${f.kit_model===v?'selected':''}>${v}</option>`).join('')
              : ''}
          </select>
        </div>
      </div>
    </div>
  </div>

  <!-- 2.3 Operation length + รูปถ่าย -->
  <div style="padding:14px 16px;background:#fff">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#64748b" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
      </svg>
      <span style="font-size:12px;font-weight:600;color:#374151">Operation length (mm) + รูปถ่าย</span>
    </div>
    ${buildMeasTable()}
  </div>

  </div><!-- end collapsible body -->

</div>`;
}

function _syncAndRenderFeeders() {
  // sync current DOM field values back into feeders[] before re-rendering
  const phases = ['A','B','C'], keys = ['L','S','dia','K'];
  feeders.forEach((f, i) => {
    phases.forEach(ph => {
      f.measurements ??= {};
      f.measurements[ph] ??= {};
      keys.forEach(k => {
        const el = document.getElementById(`tkf-f${i}-m-${ph}-${k}`);
        if (el) f.measurements[ph][k] = el.value.trim();
      });
    });
    const circuit = document.getElementById(`tkf-f${i}-circuit`)?.value;
    if (circuit !== undefined) f.circuit_designation = circuit;
    f.voltage      = document.getElementById(`tkf-f${i}-voltage`)?.value      || f.voltage;
    f.cable_size   = document.getElementById(`tkf-f${i}-cable-size`)?.value   || f.cable_size;
    f.kit_brand    = document.getElementById(`tkf-f${i}-kit-brand`)?.value    || f.kit_brand;
    f.kit_type     = document.getElementById(`tkf-f${i}-kit-type`)?.value     || f.kit_type;
    f.kit_model    = document.getElementById(`tkf-f${i}-kit-model`)?.value    || f.kit_model;
    f.install_position = document.getElementById(`tkf-f${i}-install-pos`)?.value      || f.install_position;
  });
  renderFeeders();
}

function renderFeeders() {
  const container = document.getElementById('tk-feeders-list');
  if (!container) return;
  if (feeders.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:32px 24px;color:#94a3b8;font-size:12px;
                  border:2px dashed #e2e8f0;border-radius:12px;background:#fafbfc">
        <div style="width:44px;height:44px;border-radius:12px;background:#f1f5f9;
                    display:flex;align-items:center;justify-content:center;margin:0 auto 10px">
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#cbd5e1" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
        </div>
        <div style="font-weight:600;color:#64748b;margin-bottom:4px">ยังไม่มีวงจร</div>
        <div style="font-size:11px">กดปุ่ม <strong style="color:#16a34a">+ เพิ่มวงจร</strong> เพื่อเริ่มต้น</div>
      </div>`;
    return;
  }
  container.innerHTML = feeders.map((f, i) => feederCardHTML(i, f)).join('');
}

// ── Drag & Drop reorder ───────────────────────────────────────
let _dragSrcIdx = null;

window._tkDragStart = function (e, idx) {
  _dragSrcIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.45';
};

window._tkDragOver = function (e, idx) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (idx === _dragSrcIdx) return;
  e.currentTarget.style.transform = _dragSrcIdx < idx
    ? 'translateY(4px)' : 'translateY(-4px)';
};

window._tkDragLeave = function (e, idx) {
  e.currentTarget.style.transform = '';
};

window._tkDrop = function (e, idx) {
  e.preventDefault();
  e.currentTarget.style.transform = '';
  if (_dragSrcIdx === null || _dragSrcIdx === idx) return;

  // sync DOM values into feeders before reorder
  const phases = ['A','B','C'], keys = ['L','S','dia','K'];
  feeders.forEach((f, i) => {
    phases.forEach(ph => {
      f.measurements ??= {};
      f.measurements[ph] ??= {};
      keys.forEach(k => {
        const el = document.getElementById(`tkf-f${i}-m-${ph}-${k}`);
        if (el) f.measurements[ph][k] = el.value.trim();
      });
    });
    const circuit = document.getElementById(`tkf-f${i}-circuit`)?.value || '';
    if (circuit) f.circuit_designation = circuit;
    f.voltage    = document.getElementById(`tkf-f${i}-voltage`)?.value || f.voltage;
    f.cable_size = document.getElementById(`tkf-f${i}-cable-size`)?.value || f.cable_size;
    f.kit_brand  = document.getElementById(`tkf-f${i}-kit-brand`)?.value || f.kit_brand;
    f.kit_type   = document.getElementById(`tkf-f${i}-kit-type`)?.value || f.kit_type;
    f.kit_model  = document.getElementById(`tkf-f${i}-kit-model`)?.value || f.kit_model;
    f.install_position = document.getElementById(`tkf-f${i}-install-pos`)?.value      || f.install_position;
  });

  const moved = feeders.splice(_dragSrcIdx, 1)[0];
  feeders.splice(idx, 0, moved);
  _dragSrcIdx = null;
  renderFeeders();
  window._tkLivePreview();
};

window._tkDragEnd = function (e) {
  _dragSrcIdx = null;
  document.querySelectorAll('[data-feeder-idx]').forEach(el => {
    el.style.opacity   = '';
    el.style.transform = '';
  });
};

window._tkToggleSection = function (key) {
  const body    = document.getElementById(`tk-body-${key}`);
  const chevron = document.getElementById(`tk-chevron-${key}`);
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display       = open ? '' : 'none';
  chevron.style.transform  = open ? 'rotate(180deg)' : '';
};

window._tkToggleFeeder = function (idx) {
  const body    = document.getElementById(`tk-feeder-${idx}-body`);
  const chevron = document.getElementById(`tk-feeder-${idx}-chevron`);
  if (!body) return;
  const collapsed = body.style.display === 'none';
  body.style.display    = collapsed ? '' : 'none';
  chevron.style.transform = collapsed ? 'rotate(180deg)' : '';
};

// ── Signature pad ────────────────────────────────────────────
let globalInstallerSig = null;
const _sigState = {};
function _sigGetPos(canvas, e) {
  const r = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / r.width;
  const scaleY = canvas.height / r.height;
  const src = e.touches ? e.touches[0] : e;
  return { x: (src.clientX - r.left) * scaleX, y: (src.clientY - r.top) * scaleY };
}
window._tkSigStart = function (idx, e) {
  e.preventDefault();
  const canvas = document.getElementById(`tkf-f${idx}-sig-canvas`);
  if (!canvas) return;
  const hint = document.getElementById(`tkf-f${idx}-sig-hint`);
  if (hint) hint.style.display = 'none';
  _sigState[idx] = { drawing: true, canvas, ctx: canvas.getContext('2d') };
  const { x, y } = _sigGetPos(canvas, e);
  _sigState[idx].ctx.beginPath();
  _sigState[idx].ctx.moveTo(x, y);
};
window._tkSigMove = function (idx, e) {
  e.preventDefault();
  const s = _sigState[idx];
  if (!s?.drawing) return;
  const { x, y } = _sigGetPos(s.canvas, e);
  s.ctx.lineTo(x, y);
  s.ctx.strokeStyle = '#1e293b';
  s.ctx.lineWidth = 2.5;
  s.ctx.lineCap = 'round';
  s.ctx.lineJoin = 'round';
  s.ctx.stroke();
};
window._tkSigEnd = function (idx) {
  const s = _sigState[idx];
  if (!s?.drawing) return;
  s.drawing = false;
  feeders[idx].install_signature = s.canvas.toDataURL('image/png');
  window._tkLivePreview();
};
window._tkSigUpload = function (idx, input) {
  if (!input.files?.[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById(`tkf-f${idx}-sig-canvas`);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // scale to fit canvas maintaining aspect ratio
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      feeders[idx].install_signature = canvas.toDataURL('image/png');
      const hint = document.getElementById(`tkf-f${idx}-sig-hint`);
      if (hint) hint.style.display = 'none';
      window._tkLivePreview();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(input.files[0]);
  input.value = '';
};

window._tkSigClear = function (idx) {
  const canvas = document.getElementById(`tkf-f${idx}-sig-canvas`);
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  const hint = document.getElementById(`tkf-f${idx}-sig-hint`);
  if (hint) hint.style.display = 'flex';
  if (feeders[idx]) feeders[idx].install_signature = null;
  window._tkLivePreview();
};
// restore saved signature onto canvas after render
function _tkRestoreSig(idx) {
  const f = feeders[idx];
  if (!f?.install_signature) return;
  const canvas = document.getElementById(`tkf-f${idx}-sig-canvas`);
  if (!canvas) return;
  const img = new Image();
  img.onload = () => canvas.getContext('2d').drawImage(img, 0, 0);
  img.src = f.install_signature;
  const hint = document.getElementById(`tkf-f${idx}-sig-hint`);
  if (hint) hint.style.display = 'none';
}

// ── Global installer signature ────────────────────────────────
const _globalSigState = {};
window._tkGlobalSigStart = function (e) {
  e.preventDefault();
  const canvas = document.getElementById('tkf-global-sig-canvas');
  if (!canvas) return;
  const hint = document.getElementById('tkf-global-sig-hint');
  if (hint) hint.style.display = 'none';
  const r = canvas.getBoundingClientRect();
  const scaleX = canvas.width / r.width, scaleY = canvas.height / r.height;
  const src = e.touches ? e.touches[0] : e;
  const x = (src.clientX - r.left) * scaleX, y = (src.clientY - r.top) * scaleY;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#1e293b';
  ctx.beginPath(); ctx.moveTo(x, y);
  _globalSigState.drawing = true; _globalSigState.canvas = canvas; _globalSigState.ctx = ctx;
};
window._tkGlobalSigMove = function (e) {
  e.preventDefault();
  if (!_globalSigState.drawing) return;
  const r = _globalSigState.canvas.getBoundingClientRect();
  const scaleX = _globalSigState.canvas.width / r.width, scaleY = _globalSigState.canvas.height / r.height;
  const src = e.touches ? e.touches[0] : e;
  const x = (src.clientX - r.left) * scaleX, y = (src.clientY - r.top) * scaleY;
  _globalSigState.ctx.lineTo(x, y);
  _globalSigState.ctx.stroke();
  _globalSigState.ctx.beginPath(); _globalSigState.ctx.moveTo(x, y);
};
window._tkGlobalSigEnd = function () {
  if (!_globalSigState.drawing) return;
  _globalSigState.drawing = false;
  const canvas = document.getElementById('tkf-global-sig-canvas');
  if (canvas) globalInstallerSig = canvas.toDataURL('image/png');
  window._tkLivePreview();
};
window._tkGlobalSigClear = function () {
  const canvas = document.getElementById('tkf-global-sig-canvas');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  const hint = document.getElementById('tkf-global-sig-hint');
  if (hint) hint.style.display = 'flex';
  globalInstallerSig = null;
  window._tkLivePreview();
};
window._tkGlobalSigUpload = function (input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const canvas = document.getElementById('tkf-global-sig-canvas');
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      globalInstallerSig = canvas.toDataURL('image/png');
      const hint = document.getElementById('tkf-global-sig-hint');
      if (hint) hint.style.display = 'none';
      window._tkLivePreview();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
};
function _tkRestoreGlobalSig() {
  if (!globalInstallerSig) return;
  const canvas = document.getElementById('tkf-global-sig-canvas');
  if (!canvas) return;
  const img = new Image();
  img.onload = () => canvas.getContext('2d').drawImage(img, 0, 0);
  img.src = globalInstallerSig;
  const hint = document.getElementById('tkf-global-sig-hint');
  if (hint) hint.style.display = 'none';
}

window._tkCollapseFeeder = function (idx) {
  const body    = document.getElementById(`tk-feeder-${idx}-body`);
  const chevron = document.getElementById(`tk-feeder-${idx}-chevron`);
  if (!body) return;
  body.style.display      = 'none';
  if (chevron) chevron.style.transform = 'rotate(0deg)';
};

window._tkExpandFeeder = function (idx) {
  const body    = document.getElementById(`tk-feeder-${idx}-body`);
  const chevron = document.getElementById(`tk-feeder-${idx}-chevron`);
  if (!body) return;
  body.style.display      = '';
  chevron.style.transform = 'rotate(180deg)';
};

window._tkAddFeeder = function () {
  // auto-expand inst section
  const body    = document.getElementById('tk-body-inst');
  const chevron = document.getElementById('tk-chevron-inst');
  if (body && body.style.display === 'none') {
    body.style.display      = '';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
  }
  feeders.push({ _localId: crypto.randomUUID() });
  renderFeeders();
  window._tkLivePreview();
  const newIdx = feeders.length - 1;
  // start collapsed — user expands manually
  window._tkCollapseFeeder(newIdx);
  const last = document.getElementById(`tk-feeder-${newIdx}`);
  last?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window._tkRemoveFeeder = async function (idx) {
  const name = document.getElementById(`tk-feeder-${idx}-subtitle`)?.textContent || `วงจรที่ ${idx + 1}`;
  const ok = await window.appConfirm({ title: 'ลบวงจร', message: `ต้องการลบ "${name}" ออกใช่ไหม?`, okText: 'ลบ', okColor: '#e53e3e' });
  if (!ok) return;
  const lid = feeders[idx]?._localId;
  if (lid) {
    for (const phase of ['A','B','C'])
      for (const key of ['L','S','dia','K'])
        photoFiles.delete(`${lid}-${phase}-${key}`);
  }
  feeders.splice(idx, 1);
  renderFeeders();
  window._tkLivePreview();
  // auto-save so deletion persists
  await window._tkSave({ silent: true });
};

// ── Modal HTML ────────────────────────────────────────────────
function injectModal() {
  if (document.getElementById('modal-termination')) return;

  const html = `
<div class="modal-overlay" id="modal-termination">
  <div class="modal-box" id="modal-tk-box"
       style="max-width:80vw;width:80vw;display:flex;flex-direction:column;max-height:94vh">
    <div class="modal-head">
      <h3 id="modal-tk-title">บันทึก Power Cable Installation</h3>
      <button class="modal-close" onclick="window._tkClose()">✕</button>
    </div>

    <div style="display:flex;gap:0;flex:1;min-height:0;overflow:hidden">

      <!-- ── FORM (left) ── -->
      <div class="modal-body" style="flex:0 0 600px;width:600px;overflow-y:auto;padding:16px 20px">

      <!-- Section 1 — ข้อมูลโครงการ -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;cursor:pointer;user-select:none;
                  padding:6px 8px;border-radius:12px;transition:background .15s,box-shadow .15s;margin-left:-8px"
           onclick="window._tkToggleSection('proj')"
           onmouseover="this.style.background='#f0f4ff';this.style.boxShadow='0 2px 8px rgba(99,102,241,.1)'"
           onmouseout="this.style.background='';this.style.boxShadow=''">
        <div style="width:32px;height:32px;border-radius:10px;
                    background:linear-gradient(135deg,#3b82f6,#6366f1);
                    display:flex;align-items:center;justify-content:center;flex-shrink:0;
                    box-shadow:0 2px 8px rgba(99,102,241,.35)">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#fff" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
        </div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700;color:#1e293b;line-height:1.2">ข้อมูลโครงการ</div>
          <div style="font-size:10px;color:#94a3b8">Project Information</div>
        </div>
        <div id="tk-chevron-proj" style="width:22px;height:22px;border-radius:6px;background:#f1f5f9;
             display:flex;align-items:center;justify-content:center;transition:transform .25s;flex-shrink:0">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#64748b" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
      </div>

      <div id="tk-body-proj" style="display:none;margin-bottom:14px;padding-left:20px;border-left:2px solid #6366f1;margin-left:16px">
      <div style="background:linear-gradient(135deg,#f8f9ff,#eff2ff);
                  border:1px solid #c7d2fe;border-radius:12px;padding:10px 14px 12px;
                  border-left:4px solid #6366f1">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="#4f46e5" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <span style="font-size:11px;font-weight:700;color:#4338ca">Project Information</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;
                          letter-spacing:.5px;display:block;margin-bottom:5px">
              ชื่อโครงการ <span style="color:#ef4444">*</span>
            </label>
            <input id="tkf-project-name" class="form-control"
              placeholder="เช่น Bueng 1 substation" oninput="window._tkLivePreview()"
              style="border-radius:8px;border-color:#c7d2fe;font-size:12px">
          </div>
          <div>
            <label style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;
                          letter-spacing:.5px;display:block;margin-bottom:5px">Contract No.</label>
            <input id="tkf-contract-no" class="form-control"
              placeholder="เช่น TDDP2-BNG/2566" oninput="window._tkLivePreview()"
              style="border-radius:8px;border-color:#c7d2fe;font-size:12px">
          </div>
        </div>
      </div>
      </div>

      <!-- ผู้ดำเนินการ (ใช้ร่วมกันทุกวงจร) -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;cursor:pointer;user-select:none;
                  padding:6px 8px;border-radius:12px;transition:background .15s,box-shadow .15s;margin-left:-8px"
           onclick="window._tkToggleSection('resp')"
           onmouseover="this.style.background='#f0fdf9';this.style.boxShadow='0 2px 8px rgba(16,185,129,.1)'"
           onmouseout="this.style.background='';this.style.boxShadow=''">
        <div style="width:32px;height:32px;border-radius:10px;
                    background:linear-gradient(135deg,#10b981,#0ea5e9);
                    display:flex;align-items:center;justify-content:center;flex-shrink:0;
                    box-shadow:0 2px 8px rgba(16,185,129,.3)">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#fff" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
        </div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700;color:#1e293b;line-height:1.2">ผู้ดำเนินการ</div>
          <div style="font-size:10px;color:#94a3b8">ใช้ร่วมกันทุกวงจร · Responsibility</div>
        </div>
        <div id="tk-chevron-resp" style="width:22px;height:22px;border-radius:6px;background:#f1f5f9;
             display:flex;align-items:center;justify-content:center;transition:transform .25s;flex-shrink:0">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#64748b" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
      </div>

      <div id="tk-body-resp" style="display:none;margin-bottom:14px;padding-left:20px;border-left:2px solid #10b981;margin-left:16px">
      <div style="display:flex;flex-direction:column;gap:8px">

        <!-- Installation by -->
        <div style="background:linear-gradient(135deg,#f0fdf9,#e6faf4);border:1px solid #99f6e4;
                    border-radius:12px;padding:10px 14px 12px;border-left:4px solid #10b981">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="#047857" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
            </svg>
            <span style="font-size:11px;font-weight:700;color:#047857">Installation by</span>
          </div>
          <!-- row 1: บริษัท + ชื่อ-นามสกุล -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <div>
              <label style="font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;
                            letter-spacing:.4px;display:block;margin-bottom:3px">บริษัท</label>
              <input id="tkf-install-company" class="form-control"
                placeholder="ชื่อบริษัท" oninput="window._tkLivePreview()"
                style="border-radius:7px;border-color:#99f6e4">
            </div>
            <div>
              <label style="font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;
                            letter-spacing:.4px;display:block;margin-bottom:3px">ชื่อ-นามสกุล ผู้ติดตั้ง</label>
              <input id="tkf-global-install-name" class="form-control"
                placeholder="ชื่อผู้ติดตั้ง" oninput="window._tkLivePreview()"
                style="border-radius:7px;border-color:#99f6e4">
            </div>
          </div>
          <!-- row 2: วันที่ + ลายเซ็น -->
          <div style="display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:start">
            <div>
              <label style="font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;
                            letter-spacing:.4px;display:block;margin-bottom:3px">วันที่ติดตั้ง</label>
              <input id="tkf-global-install-date" type="date" class="form-control"
                style="border-radius:7px;border-color:#99f6e4" oninput="window._tkLivePreview()">
            </div>
            <div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                <label style="font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.4px">ลายเซ็น</label>
                <div style="display:flex;align-items:center;gap:5px">
                  <input type="file" accept="image/*" id="tkf-global-sig-upload" style="display:none"
                    onchange="window._tkGlobalSigUpload(this)">
                  <button type="button" onclick="document.getElementById('tkf-global-sig-upload').click()"
                    style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#047857;
                           background:#fff;border:1px solid #99f6e4;border-radius:5px;cursor:pointer;
                           padding:2px 8px;font-weight:500;transition:background .15s"
                    onmouseover="this.style.background='#f0fdf9'" onmouseout="this.style.background='#fff'">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>อัพโหลด</button>
                  <button type="button" onclick="window._tkGlobalSigClear()"
                    style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#047857;
                           background:#fff;border:1px solid #99f6e4;border-radius:5px;cursor:pointer;
                           padding:2px 8px;font-weight:500;transition:background .15s"
                    onmouseover="this.style.background='#f0fdf9'" onmouseout="this.style.background='#fff'">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>
                    </svg>ล้าง</button>
                </div>
              </div>
              <div style="position:relative;border:1.5px dashed #6ee7b7;border-radius:8px;background:#fff;overflow:hidden;height:78px">
                <canvas id="tkf-global-sig-canvas" width="600" height="160"
                  style="width:100%;height:100%;display:block;touch-action:none;cursor:crosshair"
                  onmousedown="window._tkGlobalSigStart(event)"
                  onmousemove="window._tkGlobalSigMove(event)"
                  onmouseup="window._tkGlobalSigEnd()"
                  onmouseleave="window._tkGlobalSigEnd()"
                  ontouchstart="window._tkGlobalSigStart(event)"
                  ontouchmove="window._tkGlobalSigMove(event)"
                  ontouchend="window._tkGlobalSigEnd()"></canvas>
                <div id="tkf-global-sig-hint" style="position:absolute;inset:0;display:flex;align-items:center;
                     justify-content:center;gap:5px;pointer-events:none;color:#6ee7b7;font-size:11px">
                  <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z"/>
                  </svg>วาดลายเซ็นที่นี่</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Witness 1 -->
        <div style="background:linear-gradient(135deg,#f0fdf9,#e6faf4);border:1px solid #99f6e4;
                    border-radius:12px;padding:10px 14px 12px;border-left:4px solid #10b981">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="#047857" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <span style="font-size:11px;font-weight:700;color:#047857">Witness by (1)</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
              <label style="font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;
                            letter-spacing:.4px;display:block;margin-bottom:3px">บริษัท</label>
              <input id="tkf-w1-company" class="form-control"
                placeholder="ชื่อบริษัท" oninput="window._tkLivePreview()"
                style="border-radius:7px;border-color:#99f6e4">
            </div>
            <div>
              <label style="font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;
                            letter-spacing:.4px;display:block;margin-bottom:3px">ชื่อ-นามสกุล</label>
              <input id="tkf-w1-name" class="form-control"
                placeholder="Witness 1" oninput="window._tkLivePreview()"
                style="border-radius:7px;border-color:#99f6e4">
            </div>
          </div>
        </div>

        <!-- Witness 2 -->
        <div style="background:linear-gradient(135deg,#f0fdf9,#e6faf4);border:1px solid #99f6e4;
                    border-radius:12px;padding:10px 14px 12px;border-left:4px solid #10b981">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="#047857" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <span style="font-size:11px;font-weight:700;color:#047857">Witness by (2)</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
              <label style="font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;
                            letter-spacing:.4px;display:block;margin-bottom:3px">บริษัท</label>
              <input id="tkf-w2-company" class="form-control"
                placeholder="เช่น PEA" oninput="window._tkLivePreview()"
                style="border-radius:7px;border-color:#99f6e4">
            </div>
            <div>
              <label style="font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;
                            letter-spacing:.4px;display:block;margin-bottom:3px">ชื่อ-นามสกุล</label>
              <input id="tkf-w2-name" class="form-control"
                placeholder="Witness 2" oninput="window._tkLivePreview()"
                style="border-radius:7px;border-color:#99f6e4">
            </div>
          </div>
        </div>


      </div>
      </div><!-- end tk-body-resp -->

      <!-- Section 2 — ข้อมูลงานติดตั้ง -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;cursor:pointer;user-select:none;
                  padding:6px 8px;border-radius:12px;transition:background .15s,box-shadow .15s;margin-left:-8px"
           onclick="window._tkToggleSection('inst')"
           onmouseover="this.style.background='#f0fdf4';this.style.boxShadow='0 2px 8px rgba(34,197,94,.1)'"
           onmouseout="this.style.background='';this.style.boxShadow=''">
        <div style="width:32px;height:32px;border-radius:10px;
                    background:linear-gradient(135deg,#22c55e,#0ea5e9);
                    display:flex;align-items:center;justify-content:center;flex-shrink:0;
                    box-shadow:0 2px 8px rgba(34,197,94,.3)">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#fff" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
        </div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700;color:#1e293b;line-height:1.2">ข้อมูลงานติดตั้ง</div>
          <div style="font-size:10px;color:#94a3b8">เพิ่มได้หลายวงจร · Installation Data</div>
        </div>
        <div id="tk-chevron-inst" style="width:22px;height:22px;border-radius:6px;background:#f1f5f9;
             display:flex;align-items:center;justify-content:center;transition:transform .25s;flex-shrink:0">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#64748b" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
      </div>
      <div id="tk-body-inst" style="display:none;padding-left:20px;border-left:2px solid #22c55e;margin-left:16px">
        <div id="tk-feeders-list"></div>
        <!-- Add feeder button inside body -->
        <button onclick="window._tkAddFeeder();this.classList.add('tk-btn-pop');setTimeout(()=>this.classList.remove('tk-btn-pop'),300)"
          style="width:100%;margin-top:10px;background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);color:#15803d;
                 border:none;border-radius:12px;
                 padding:9px;font-size:12px;font-weight:600;cursor:pointer;
                 display:flex;align-items:center;justify-content:center;gap:8px;
                 box-shadow:0 1px 4px rgba(22,163,74,.15),inset 0 1px 0 rgba(255,255,255,.7);
                 transition:all .2s;position:relative;overflow:hidden"
          onmouseover="this.style.background='linear-gradient(135deg,#dcfce7 0%,#bbf7d0 100%)';this.style.boxShadow='0 4px 12px rgba(22,163,74,.25),inset 0 1px 0 rgba(255,255,255,.7)';this.style.transform='translateY(-1px)'"
          onmouseout="this.style.background='linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%)';this.style.boxShadow='0 1px 4px rgba(22,163,74,.15),inset 0 1px 0 rgba(255,255,255,.7)';this.style.transform=''">
          <span style="width:22px;height:22px;background:#22c55e;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 6px rgba(22,163,74,.4)">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#fff" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
            </svg>
          </span>
          เพิ่มวงจร
        </button>
      </div>

      </div><!-- end form -->

      <!-- ── PREVIEW (right) ── -->
      <div id="tk-preview-panel" style="flex:1;min-width:0;border-left:1px solid #e2e8f0;display:flex;flex-direction:column;background:#f7f9fc">
        <!-- toolbar -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;flex-shrink:0">
          <span style="font-size:12px;color:#888">— ตัวอย่างเอกสาร (อัปเดตอัตโนมัติ) —</span>
          <div style="display:flex;align-items:center;gap:6px">
            <button onclick="window._tkPreviewZoom(-0.1)"
              style="width:26px;height:26px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:15px;line-height:1;color:#475569;display:flex;align-items:center;justify-content:center"
              title="ซูมออก">−</button>
            <span id="tk-preview-zoom-label" style="font-size:11px;color:#475569;font-weight:600;min-width:36px;text-align:center">62%</span>
            <button onclick="window._tkPreviewZoom(0.1)"
              style="width:26px;height:26px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:15px;line-height:1;color:#475569;display:flex;align-items:center;justify-content:center"
              title="ซูมเข้า">+</button>
            <button onclick="window._tkPreviewZoomReset()"
              style="height:26px;padding:0 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:10px;color:#475569;font-weight:600"
              title="รีเซ็ต">Reset</button>
          </div>
        </div>
        <div style="flex:1;overflow:auto;padding:16px;display:flex;justify-content:center">
          <div id="tk-preview-content" style="zoom:0.62;width:210mm;box-sizing:border-box;flex-shrink:0"></div>
        </div>
      </div>

    </div><!-- end flex -->

    <div class="modal-foot">
      <button class="btn btn-outline" onclick="window._tkClose()">ยกเลิก</button>
      <button class="btn btn-outline" onclick="window._tkPrintCurrent()"
              style="display:flex;align-items:center;gap:6px">🖨️ พิมพ์ / PDF</button>
      <button class="btn btn-primary" id="tk-save-btn" onclick="window._tkSave()">💾 บันทึก</button>
    </div>
  </div>
</div>`;

  document.body.insertAdjacentHTML('beforeend', html);
}

// ── Form helpers ──────────────────────────────────────────────
function populateJobDropdown() {
  const sel = document.getElementById('tkf-job');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- เลือกงาน --</option>' +
    getJobs().map(j =>
      `<option value="${j.id}"
        data-name="${escH(j.job_name || '')}"
        data-code="${escH(j.job_code || '')}"
        data-company="${escH(j.company || '')}"
        data-type="${escH(j.job_type || '')}">
        ${escH(j.job_name)}${j.job_code ? ' (' + escH(j.job_code) + ')' : ''}
      </option>`
    ).join('');
}

function updateJobInfoBar() {
  const sel     = document.getElementById('tkf-job');
  const opt     = sel?.options[sel.selectedIndex];
  const infoBar = document.getElementById('tkf-job-info');
  const infoTxt = document.getElementById('tkf-job-info-text');
  if (!infoBar || !infoTxt) return;
  if (opt?.value) {
    const parts = [];
    if (opt.dataset.type)    parts.push(`หน่วยงาน: <strong>${escH(opt.dataset.type)}</strong>`);
    if (opt.dataset.code)    parts.push(`รหัส JOB: <strong style="color:#1d4ed8">${escH(opt.dataset.code)}</strong>`);
    if (opt.dataset.company) parts.push(`บริษัท: <strong>${escH(opt.dataset.company)}</strong>`);
    infoTxt.innerHTML = parts.join(' &nbsp;|&nbsp; ');
    infoBar.style.display = 'block';
  } else {
    infoBar.style.display = 'none';
  }
}

function _tkGetTypeTheme(type) {
  if (type === 'Outdoor') return { bg:'#f0fdf4', border:'#22c55e', text:'#15803d', badgeBg:'#dcfce7', badgeColor:'#15803d', badgeBorder:'#86efac' };
  if (type === 'Indoor')  return { bg:'#f0f4ff', border:'#4f7aeb', text:'#1e40af', badgeBg:'#dbeafe', badgeColor:'#1d4ed8', badgeBorder:'#93c5fd' };
  return { bg:'#f8fafc', border:'#94a3b8', text:'#475569', badgeBg:'#f1f5f9', badgeColor:'#64748b', badgeBorder:'#cbd5e1' };
}

function _tkUpdateFeederHeader(idx) {
  const g = id => document.getElementById(`tkf-f${idx}-${id}`)?.value || '';
  const circuitRaw = g('circuit') || feeders[idx]?.circuit_designation || `วงจรที่ ${idx + 1}`;
  const kitType = g('kit-type') || feeders[idx]?.kit_type || '';
  const posVal  = g('install-pos') || feeders[idx]?.install_position || '';

  // validation — check required fields + photos
  const missingFields = !g('circuit') || !g('cable-size') || !g('kit-brand') || !g('kit-type') || !g('kit-model');
  const lid = feeders[idx]?._localId || '';
  const missingPhotos = ['A','B','C'].some(ph =>
    ['L','S','dia','K'].some(k => {
      const hasFile = lid && photoFiles.has(`${lid}-${ph}-${k}`);
      const hasUrl  = feeders[idx]?.measurements?.[ph]?.photos?.[k];
      return !hasFile && !hasUrl;
    })
  );
  const missing = missingFields || missingPhotos;
  const th = missing
    ? { bg:'#fff5f5', border:'#f87171', text:'#991b1b' }
    : _tkGetTypeTheme(kitType);

  const headerEl = document.getElementById(`tk-feeder-${idx}-header`);
  if (headerEl) {
    headerEl.style.background   = th.bg;
    headerEl.style.borderLeft   = `4px solid ${th.border}`;
    headerEl.style.borderBottom = `1px solid ${th.border}33`;
  }

  const subParts = [posVal ? escH(posVal) : '', kitType ? `${escH(kitType)} Termination Kit` : ''].filter(Boolean);
  const subSuffix = subParts.length ? `  <span style="color:${th.border};font-weight:500">(${subParts.join(' - ')})</span>` : '';

  const sub = document.getElementById(`tk-feeder-${idx}-subtitle`);
  if (sub) {
    sub.innerHTML = `<span style="font-size:10.5px;font-weight:500;color:${th.text};letter-spacing:.1px">${escH(circuitRaw)}${subSuffix}</span>`;
  }
}

window._tkPosChange = function (idx, val) {
  feeders[idx].install_position = val;
  _tkUpdateFeederHeader(idx);
};

window._tkKitBrandChange = function (idx) {
  const modelEl = document.getElementById(`tkf-f${idx}-kit-model`);
  if (modelEl) modelEl.innerHTML = `<option value="">-- เลือก --</option>`;
  window._tkLivePreview();
};

window._tkKitTypeChange = function (idx) {
  const brand = document.getElementById(`tkf-f${idx}-kit-brand`)?.value || '';
  const type  = document.getElementById(`tkf-f${idx}-kit-type`)?.value  || '';
  const modelEl = document.getElementById(`tkf-f${idx}-kit-model`);
  if (!modelEl) return;
  const rows = kitRows.filter(r => r.brand === brand && r.type === type && r.is_active);
  modelEl.innerHTML = `<option value="">-- เลือก --</option>` +
    rows.map(r => `<option value="${r.model}">${r.model}</option>`).join('');
  if (feeders[idx]) feeders[idx].detail_image_url = null;
  _tkUpdateFeederHeader(idx);
  window._tkLivePreview();
};

window._tkKitModelChange = function (idx) {
  const brand = document.getElementById(`tkf-f${idx}-kit-brand`)?.value || '';
  const type  = document.getElementById(`tkf-f${idx}-kit-type`)?.value  || '';
  const model = document.getElementById(`tkf-f${idx}-kit-model`)?.value || '';
  const row   = kitRows.find(r => r.brand === brand && r.type === type && r.model === model);
  if (feeders[idx]) feeders[idx].detail_image_url = row?.detail_image_url || null;
  window._tkLivePreview();
};

window._tkJobChange = function () {
  const sel    = document.getElementById('tkf-job');
  const opt    = sel?.options[sel.selectedIndex];
  const nameEl = document.getElementById('tkf-project-name');
  if (opt?.value && nameEl) nameEl.value = opt.dataset.name || '';
  updateJobInfoBar();
  window._tkLivePreview();
};

function getFormValues() {
  const g  = id => document.getElementById(id)?.value?.trim() || '';
  const phases = ['A','B','C'];
  const keys   = ['L','S','dia','K'];

  const feedersData = feeders.map((f, idx) => {
    const measurements = {};
    phases.forEach(ph => {
      measurements[ph] = { photos: { ...(f.measurements?.[ph]?.photos || {}) } };
      keys.forEach(k => { measurements[ph][k] = g(`tkf-f${idx}-m-${ph}-${k}`); });
    });
    return {
      circuit_designation: g(`tkf-f${idx}-circuit`),
      voltage:             g(`tkf-f${idx}-voltage`) || '33',
      cable_size:          g(`tkf-f${idx}-cable-size`),
      kit_brand:           g(`tkf-f${idx}-kit-brand`),
      kit_type:            g(`tkf-f${idx}-kit-type`),
      kit_model:           g(`tkf-f${idx}-kit-model`),
      detail_image_url:    feeders[idx]?.detail_image_url || null,
      install_name:        g('tkf-global-install-name'),
      install_date:        g('tkf-global-install-date') || null,
      install_position:    g(`tkf-f${idx}-install-pos`) || null,
      install_signature:   globalInstallerSig || null,
      measurements,
    };
  });

  return {
    job_id:                  g('tkf-job') || null,
    project_name:            g('tkf-project-name'),
    contract_no:             g('tkf-contract-no'),
    install_company:         g('tkf-install-company'),
    witness1_company:        g('tkf-w1-company'),
    witness1_name:           g('tkf-w1-name'),
    witness2_company:        g('tkf-w2-company'),
    witness2_name:           g('tkf-w2-name'),
    global_install_name:     g('tkf-global-install-name') || null,
    global_install_date:     g('tkf-global-install-date') || null,
    global_install_signature: globalInstallerSig || null,
    feeders:                 feedersData,
  };
}

function fillForm(d) {
  const sv = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  sv('tkf-job',              d.job_id || '');
  sv('tkf-project-name',     d.project_name || '');
  sv('tkf-contract-no',      d.contract_no || '');
  sv('tkf-install-company',        d.install_company || '');
  sv('tkf-w1-company',             d.witness1_company || '');
  sv('tkf-w1-name',                d.witness1_name || '');
  sv('tkf-w2-company',             d.witness2_company || '');
  sv('tkf-w2-name',                d.witness2_name || '');
  // global installer — fallback to first feeder's data for backward compat
  const _f0 = d.feeders?.[0];
  sv('tkf-global-install-name', d.global_install_name || _f0?.install_name || '');
  sv('tkf-global-install-date', d.global_install_date || _f0?.install_date || '');
  globalInstallerSig = d.global_install_signature || _f0?.install_signature || null;
  _tkRestoreGlobalSig();
  updateJobInfoBar();

  feeders = (d.feeders || []).map(f => ({ ...f, _localId: crypto.randomUUID() }));
  renderFeeders();

  // restore measurement values + photo thumbnails after render
  feeders.forEach((f, i) => {
    const sv2 = (id, val) => { const el = document.getElementById(`tkf-f${i}-${id}`); if (el) el.value = val ?? ''; };
    sv2('circuit',         f.circuit_designation || '');
    sv2('voltage',         f.voltage || '33');
    sv2('cable-size',      f.cable_size || '');
    sv2('kit-brand',       f.kit_brand || '');
    if (f.kit_brand) window._tkKitBrandChange(i);
    sv2('kit-type',        f.kit_type || '');
    if (f.kit_brand && f.kit_type) window._tkKitTypeChange(i);
    sv2('kit-model',       f.kit_model || '');
    if (f.kit_brand && f.kit_type && f.kit_model) window._tkKitModelChange(i);

    sv2('install-pos',     f.install_position || '');
    _tkUpdateFeederHeader(i);
    _tkRestoreSig(i);

    for (const phase of ['A','B','C']) {
      const pm = f.measurements?.[phase] || {};
      for (const key of ['L','S','dia','K']) {
        const valEl = document.getElementById(`tkf-f${i}-m-${phase}-${key}`);
        if (valEl) valEl.value = pm[key] || '';
        const url = pm.photos?.[key];
        if (url) {
          const thumb = document.getElementById(`tkf-thumb-${i}-${phase}-${key}`);
          if (thumb) {
            thumb.style.backgroundImage    = `url(${url})`;
            thumb.style.backgroundSize     = 'cover';
            thumb.style.backgroundPosition = 'center';
            thumb.innerHTML = `<div onclick="window._tkPhotoClear(${i},'${phase}','${key}',event)"
              style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.45);color:#fff;
                     border-radius:50%;width:16px;height:16px;font-size:10px;line-height:16px;
                     text-align:center;cursor:pointer">✕</div>`;
          }
        }
      }
    }
  });
}

function clearForm() {
  ['tkf-job','tkf-project-name','tkf-contract-no',
   'tkf-install-company','tkf-w1-company','tkf-w1-name','tkf-w2-company','tkf-w2-name'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const infoBar = document.getElementById('tkf-job-info');
  if (infoBar) infoBar.style.display = 'none';
  feeders = [];
  photoFiles.clear();
  renderFeeders();
  editId = null;
}

// ── Live Preview ──────────────────────────────────────────────
let _tkPreviewZoomLevel = 0.62;
window._tkPreviewZoom = function (delta) {
  _tkPreviewZoomLevel = Math.min(1.5, Math.max(0.3, _tkPreviewZoomLevel + delta));
  const el = document.getElementById('tk-preview-content');
  if (el) el.style.zoom = _tkPreviewZoomLevel;
  const lbl = document.getElementById('tk-preview-zoom-label');
  if (lbl) lbl.textContent = Math.round(_tkPreviewZoomLevel * 100) + '%';
};
window._tkPreviewZoomReset = function () {
  _tkPreviewZoomLevel = 0.62;
  const el = document.getElementById('tk-preview-content');
  if (el) el.style.zoom = _tkPreviewZoomLevel;
  const lbl = document.getElementById('tk-preview-zoom-label');
  if (lbl) lbl.textContent = '62%';
};

let _livePreviewTimer = null;
window._tkLivePreview = function () {
  clearTimeout(_livePreviewTimer);
  _livePreviewTimer = setTimeout(() => {
    const el = document.getElementById('tk-preview-content');
    if (!el) return;
    el.innerHTML = buildTerminationPrintHTML(getFormValues());
    feeders.forEach((_, i) => _tkUpdateFeederHeader(i));
  }, 400);
};

window._tkPrintCurrent = function () {
  doTerminationPrint(getFormValues());
};

window._tkShowPreview = function () {
  const d          = getFormValues();
  const html       = buildTerminationPrintHTML(d);
  const totalPages = (d.feeders.length || 1) * 4;

  let overlay = document.getElementById('tk-preview-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'tk-preview-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.78);' +
      'display:flex;flex-direction:column;align-items:center;overflow-y:auto;padding:20px 16px 40px';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div style="width:100%;max-width:820px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="color:#fff;font-size:15px;font-weight:600">
          ตัวอย่างเอกสาร (${totalPages} หน้า — ${d.feeders.length || 1} วงจร × 4 หน้า)
        </span>
        <div style="display:flex;gap:8px">
          <button onclick="window._tkPrintCurrent()"
            style="background:#1a56db;color:#fff;border:none;border-radius:6px;
                   padding:7px 16px;cursor:pointer;font-size:13px">
            🖨️ พิมพ์ / PDF
          </button>
          <button onclick="document.getElementById('tk-preview-overlay').style.display='none'"
            style="background:#fff;color:#1a202c;border:none;border-radius:6px;
                   padding:7px 16px;cursor:pointer;font-size:13px">✕ ปิด</button>
        </div>
      </div>
      <div style="background:#e5e7eb;padding:16px;border-radius:6px;
                  display:flex;flex-direction:column;gap:16px">
        <div style="zoom:0.62;width:210mm;box-sizing:border-box">${html}</div>
      </div>
    </div>`;

  overlay.style.display = 'flex';
  overlay.onclick = e => { if (e.target === overlay) overlay.style.display = 'none'; };
};

// ── Open / Close ──────────────────────────────────────────────
window._tkOpen = function (id) {
  injectModal();
  populateJobDropdown();
  clearForm();
  editId        = id || null;
  formSessionId = id || crypto.randomUUID();
  const titleEl = document.getElementById('modal-tk-title');
  if (titleEl) titleEl.textContent = id ? 'แก้ไข Power Cable Installation' : 'บันทึก Power Cable Installation';
  if (id) {
    const rec = records.find(r => r.id === id);
    if (rec) fillForm(rec);
  }
  document.getElementById('modal-termination').classList.add('open');
  window._tkLivePreview();
};

window._tkClose = function () {
  document.getElementById('modal-termination')?.classList.remove('open');
};

// ── Save ──────────────────────────────────────────────────────
window._tkSave = async function (opts = {}) {
  const silent = opts?.silent === true;
  const d = getFormValues();
  if (!silent) {
    if (!d.project_name)  { toast('กรุณากรอก ชื่อโครงการ'); return; }
    if (!d.feeders.length){ toast('กรุณาเพิ่มอย่างน้อย 1 วงจร'); return; }
  }
  if (!editId && !d.project_name) return; // silent: skip if new record with no project name

  const btn = document.getElementById('tk-save-btn');
  if (!silent && btn) { btn.disabled = true; btn.textContent = '⏳ กำลังบันทึก...'; }

  try {
    // sync ALL DOM fields into feeders before upload
    const phases = ['A','B','C'];
    const keys   = ['L','S','dia','K'];
    feeders.forEach((f, idx) => {
      phases.forEach(ph => {
        f.measurements ??= {};
        f.measurements[ph] ??= {};
        f.measurements[ph].photos ??= {};
        keys.forEach(k => {
          const el = document.getElementById(`tkf-f${idx}-m-${ph}-${k}`);
          if (el) f.measurements[ph][k] = el.value.trim();
        });
      });
      const g2 = id => document.getElementById(`tkf-f${idx}-${id}`)?.value ?? '';
      f.circuit_designation = g2('circuit') || f.circuit_designation || '';
      f.voltage      = g2('voltage')      || f.voltage      || '33';
      f.cable_size   = g2('cable-size')   || f.cable_size   || '';
      f.kit_brand    = g2('kit-brand')    || f.kit_brand    || '';
      f.kit_type     = g2('kit-type')     || f.kit_type     || '';
      f.kit_model    = g2('kit-model')    || f.kit_model    || '';
      f.install_name     = g2('install-name') || f.install_name     || '';
      f.install_date     = g2('install-date') || f.install_date     || '';
      f.install_position = g2('install-pos')  || f.install_position || '';
    });

    await uploadPendingPhotos();

    const finalData = getFormValues();
    const { data: { session } } = await sb.auth.getSession();

    const payload = {
      job_id:           finalData.job_id || null,
      project_name:     finalData.project_name,
      contract_no:      finalData.contract_no,
      install_company:  finalData.install_company,
      witness1_company: finalData.witness1_company,
      witness1_name:    finalData.witness1_name,
      witness2_company: finalData.witness2_company,
      witness2_name:    finalData.witness2_name,
      feeders:          finalData.feeders,
    };

    if (editId) {
      payload.id = editId;
    } else {
      payload.created_by = session?.user?.id;
    }

    await saveRecord(payload);
    photoFiles.clear();
    if (!silent) {
      toast(editId ? 'อัปเดตแล้ว ✓' : 'บันทึกแล้ว ✓');
      window._tkClose();
      records = await listRecords();
      renderTab();
    }
  } catch (e) {
    if (!silent) toast('เกิดข้อผิดพลาด: ' + e.message);
  } finally {
    if (!silent && btn) { btn.disabled = false; btn.textContent = '💾 บันทึก'; }
  }
};

// ── Delete ────────────────────────────────────────────────────
window._tkDelete = async function (id) {
  const ok = await window.appConfirm({ title: 'ลบรายการ', message: 'ต้องการลบรายการนี้ออกใช่ไหม? ไม่สามารถกู้คืนได้', okText: 'ลบ', okColor: '#e53e3e' });
  if (!ok) return;
  try {
    await deleteRecord(id);
    records = records.filter(r => r.id !== id);
    toast('ลบรายการแล้ว');
    renderTab();
  } catch (e) {
    toast('เกิดข้อผิดพลาด: ' + e.message);
  }
};

window._tkPreviewPDF = function (id) {
  const rec = records.find(r => r.id === id);
  if (rec) doTerminationPrint(rec);
};

// ── Render tab ────────────────────────────────────────────────
function renderTab() {
  const pane = document.getElementById('tab-termination');
  if (!pane) return;

  const rows = records.length
    ? records.map(r => {
        const fs         = r.feeders || [];
        const circuits   = fs.map(f => f.circuit_designation).filter(Boolean).join(', ') || '—';
        const firstDate  = fs[0]?.install_date;
        const kitModels  = [...new Set(fs.map(f => f.kit_model).filter(Boolean))].join(', ') || '—';
        const positions  = [...new Set(fs.map(f => f.install_position).filter(Boolean))].join(', ') || '—';
        return `
        <tr>
          <td>${fmtDate(firstDate)}</td>
          <td>
            <strong>${r.project_name || '—'}</strong>
            ${r.contract_no ? `<br><span style="font-size:11px;color:#94a3b8">${r.contract_no}</span>` : ''}
          </td>
          <td style="font-size:12px">${circuits}</td>
          <td>
            <span style="background:#dbeafe;color:#1d4ed8;border-radius:12px;
                         padding:2px 10px;font-size:11px;font-weight:600">
              ${fs.length} วงจร
            </span>
          </td>
          <td style="font-size:12px">${kitModels}</td>
          <td style="font-size:12px">${positions}</td>
          <td>${r.profiles?.full_name || '—'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-outline"
              style="font-size:11px;padding:3px 10px;margin-right:4px"
              onclick="window._tkOpen('${r.id}')">แก้ไข</button>
            <button class="btn btn-sm btn-outline"
              style="font-size:11px;padding:3px 10px;margin-right:4px;color:#16a34a;border-color:#16a34a"
              onclick="window._tkPreviewPDF('${r.id}')">🖨️ PDF</button>
            <button class="btn btn-sm btn-outline"
              style="font-size:11px;padding:3px 10px;color:#e53e3e;border-color:#e53e3e"
              onclick="window._tkDelete('${r.id}')">ลบ</button>
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="8" style="text-align:center;padding:40px;color:#94a3b8">
         ยังไม่มีข้อมูล — กดปุ่ม <strong>+ บันทึกใหม่</strong> เพื่อเริ่มต้น
       </td></tr>`;

  pane.innerHTML = `
  <div class="card">
    <div class="card-header">
      <h3>Power Cable Installation — Raychem Termination Kit</h3>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" onclick="window._tkOpen()">+ บันทึกใหม่</button>
        <button class="btn btn-outline" onclick="window._openKitMgr()"
          style="font-size:12px;color:#7c3aed;border-color:#7c3aed">⚙ จัดการ Kit</button>
      </div>
    </div>
    <div class="card-body">
      <table>
        <thead>
          <tr>
            <th>วันที่</th>
            <th>โครงการ / Contract</th>
            <th>วงจร</th>
            <th>จำนวน</th>
            <th>Kit Model</th>
            <th>ตำแหน่ง</th>
            <th>บันทึกโดย</th>
            <th>จัดการ</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

// ── Kit catalogue CRUD ────────────────────────────────────────
async function loadKitCatalogue() {
  const { data } = await sb.from('kit_catalogue').select('*').order('brand').order('type').order('sort_order');
  kitRows = data || [];
}
async function addKitRow(brand, type, model) {
  const sort_order = kitRows.filter(r => r.brand === brand && r.type === type).length + 1;
  const { data, error } = await sb.from('kit_catalogue').insert({ brand, type, model, sort_order }).select().single();
  if (error) throw error;
  kitRows.push(data);
}
async function deleteKitRow(id) {
  const { error } = await sb.from('kit_catalogue').delete().eq('id', id);
  if (error) throw error;
  kitRows = kitRows.filter(r => r.id !== id);
}

// ── Kit management modal ──────────────────────────────────────
function injectKitModal() {
  if (document.getElementById('modal-kit-mgr')) return;
  // inject keyframe animations once
  if (!document.getElementById('_kit-mgr-styles')) {
    const s = document.createElement('style');
    s.id = '_kit-mgr-styles';
    s.textContent = `
      #modal-kit-mgr .kit-modal-box {
        transform: translateY(32px) scale(0.97);
        opacity: 0;
        transition: transform 0.3s cubic-bezier(.34,1.56,.64,1), opacity 0.25s ease;
      }
      #modal-kit-mgr.open .kit-modal-box {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
      .kit-row-item {
        transition: background 0.15s, box-shadow 0.15s;
      }
      .kit-row-item:hover {
        background: #f1f5ff !important;
      }
      .kit-add-input:focus {
        border-color: #6366f1 !important;
        box-shadow: 0 0 0 3px rgba(99,102,241,0.15) !important;
        outline: none;
      }
      .kit-btn-add {
        background: linear-gradient(135deg,#4f7aeb,#6366f1);
        transition: transform 0.15s, box-shadow 0.15s, filter 0.15s;
      }
      .kit-btn-add:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(99,102,241,.4) !important;
        filter: brightness(1.08);
      }
      .kit-btn-add:active { transform: scale(0.97); }
      .kit-chip-has-img {
        transition: background 0.15s, transform 0.15s;
      }
      .kit-chip-has-img:hover { transform: scale(1.04); }
      .kit-btn-upload {
        transition: border-color 0.15s, color 0.15s, background 0.15s;
      }
      .kit-btn-upload:hover {
        border-color: #6366f1 !important;
        color: #6366f1 !important;
        background: #eef2ff !important;
      }
      .kit-btn-del {
        transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.12s;
      }
      .kit-btn-del:hover {
        background: #fee2e2 !important;
        color: #ef4444 !important;
        border-color: #fca5a5 !important;
        transform: scale(1.06);
      }
      .kit-brand-section {
        animation: kitFadeSlide 0.25s ease both;
      }
      @keyframes kitFadeSlide {
        from { opacity:0; transform: translateY(10px); }
        to   { opacity:1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(s);
  }
  document.body.insertAdjacentHTML('beforeend', `
<div class="modal-overlay" id="modal-kit-mgr">
  <div class="modal-box kit-modal-box" style="max-width:820px;width:95vw;display:flex;flex-direction:column;max-height:90vh;border-radius:18px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.22)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e3a8a 0%,#4f7aeb 60%,#6366f1 100%);padding:20px 28px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;position:relative;overflow:hidden">
      <!-- decorative circles -->
      <div style="position:absolute;right:-20px;top:-30px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.07);pointer-events:none"></div>
      <div style="position:absolute;right:60px;bottom:-40px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.05);pointer-events:none"></div>
      <div style="display:flex;align-items:center;gap:14px;position:relative">
        <div style="background:rgba(255,255,255,0.18);backdrop-filter:blur(4px);border-radius:12px;padding:10px 12px;font-size:22px;box-shadow:0 2px 8px rgba(0,0,0,.15)">🔌</div>
        <div>
          <div style="color:#fff;font-size:16px;font-weight:800;letter-spacing:0.2px">Kit Catalogue</div>
          <div style="color:rgba(255,255,255,0.68);font-size:11.5px;margin-top:2px">จัดการยี่ห้อ ประเภท และรุ่นของ Termination Kit</div>
        </div>
      </div>
      <button onclick="document.getElementById('modal-kit-mgr').classList.remove('open')"
        style="background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,.25);color:#fff;cursor:pointer;
               border-radius:10px;width:36px;height:36px;font-size:17px;display:flex;
               align-items:center;justify-content:center;transition:background .15s;position:relative;flex-shrink:0"
        onmouseover="this.style.background='rgba(255,255,255,.3)'"
        onmouseout="this.style.background='rgba(255,255,255,.18)'">✕</button>
    </div>

    <div style="flex:1;overflow-y:auto;background:#f4f6fb">

      <!-- Add form card -->
      <div style="margin:20px 24px 0;background:#fff;border-radius:14px;box-shadow:0 2px 12px rgba(99,102,241,.09);border:1.5px solid #e8edf8;overflow:hidden">
        <div style="background:linear-gradient(90deg,#eef2ff,#f5f3ff);padding:12px 18px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #e8edf5">
          <div style="width:20px;height:20px;background:linear-gradient(135deg,#6366f1,#4f7aeb);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:800">+</div>
          <span style="font-size:12.5px;font-weight:700;color:#3730a3">เพิ่มรุ่นใหม่</span>
        </div>
        <div style="padding:16px 18px">
          <div style="display:grid;grid-template-columns:1fr 130px 1fr auto;gap:12px;align-items:end">
            <div>
              <label style="font-size:11px;color:#6366f1;font-weight:700;display:block;margin-bottom:5px;letter-spacing:0.3px">ยี่ห้อ</label>
              <input id="kit-add-brand" class="form-control kit-add-input" placeholder="เช่น Raychem" list="kit-brand-list"
                style="border-radius:9px;border:1.5px solid #e2e8f0;font-size:12.5px;padding:8px 12px;transition:border-color .15s,box-shadow .15s">
              <datalist id="kit-brand-list"></datalist>
            </div>
            <div>
              <label style="font-size:11px;color:#6366f1;font-weight:700;display:block;margin-bottom:5px;letter-spacing:0.3px">ประเภท</label>
              <select id="kit-add-type" class="form-control kit-add-input"
                style="border-radius:9px;border:1.5px solid #e2e8f0;font-size:12.5px;padding:8px 10px;transition:border-color .15s,box-shadow .15s">
                <option value="">-- เลือก --</option>
                <option value="Indoor">Indoor</option>
                <option value="Outdoor">Outdoor</option>
              </select>
            </div>
            <div>
              <label style="font-size:11px;color:#6366f1;font-weight:700;display:block;margin-bottom:5px;letter-spacing:0.3px">รุ่น / โมเดล</label>
              <input id="kit-add-model" class="form-control kit-add-input" placeholder="เช่น OXSU-F6141"
                style="border-radius:9px;border:1.5px solid #e2e8f0;font-size:12.5px;padding:8px 12px;transition:border-color .15s,box-shadow .15s"
                onkeydown="if(event.key==='Enter')window._kitAdd()">
            </div>
            <button onclick="window._kitAdd()" class="kit-btn-add"
              style="color:#fff;border:none;border-radius:10px;
                     padding:0 20px;height:38px;cursor:pointer;font-size:12.5px;font-weight:700;
                     white-space:nowrap;display:flex;align-items:center;gap:6px;
                     box-shadow:0 4px 12px rgba(99,102,241,.35);letter-spacing:0.2px">
              <span style="font-size:18px;line-height:1;font-weight:400">+</span> เพิ่ม
            </button>
          </div>
        </div>
      </div>

      <!-- List -->
      <div style="padding:16px 24px 24px" id="kit-mgr-table"></div>
    </div>
  </div>
</div>`);
}

function renderKitMgrTable() {
  const grouped = {};
  kitRows.forEach(r => {
    if (!grouped[r.brand]) grouped[r.brand] = {};
    if (!grouped[r.brand][r.type]) grouped[r.brand][r.type] = [];
    grouped[r.brand][r.type].push(r);
  });

  const brands = [...new Set(kitRows.map(r => r.brand))];
  const types  = [...new Set(kitRows.map(r => r.type))];
  const bdl = document.getElementById('kit-brand-list');
  const tdl = document.getElementById('kit-type-list');
  if (bdl) bdl.innerHTML = brands.map(b => `<option value="${escH(b)}">`).join('');
  if (tdl) tdl.innerHTML = types.map(t => `<option value="${escH(t)}">`).join('');

  // brand palette: gradient pairs [from, to]
  const brandPalettes = [
    ['#1e3a8a','#3b82f6'],
    ['#065f46','#10b981'],
    ['#581c87','#a855f7'],
    ['#7c2d12','#f97316'],
    ['#1e3a5f','#06b6d4'],
  ];
  const typeIcons = { Indoor: '🏢', Outdoor: '🌿' };
  let brandIdx = 0;
  let html = '';

  for (const brand of Object.keys(grouped)) {
    const [c0, c1] = brandPalettes[brandIdx++ % brandPalettes.length];
    const totalModels = Object.values(grouped[brand]).reduce((s, a) => s + a.length, 0);
    html += `<div class="kit-brand-section" style="margin-bottom:18px;border-radius:14px;overflow:hidden;box-shadow:0 3px 14px rgba(0,0,0,.09);border:1px solid rgba(0,0,0,.06)">`;

    // Brand banner
    html += `
      <div style="background:linear-gradient(135deg,${c0},${c1});padding:12px 18px;display:flex;align-items:center;gap:12px">
        <div style="background:rgba(255,255,255,.2);border-radius:8px;padding:5px 10px;font-size:12px;font-weight:800;color:#fff;letter-spacing:0.5px">${escH(brand)}</div>
        <div style="flex:1"></div>
        <div style="background:rgba(255,255,255,.18);border-radius:20px;padding:3px 12px;font-size:10.5px;color:#fff;font-weight:600">${totalModels} รุ่น</div>
      </div>`;

    for (const type of Object.keys(grouped[brand])) {
      const icon = typeIcons[type] || '🔧';
      html += `
        <!-- Type sub-header -->
        <div style="background:rgba(0,0,0,.024);padding:8px 18px;display:flex;align-items:center;gap:8px;border-top:1px solid rgba(0,0,0,.06)">
          <span style="font-size:13px">${icon}</span>
          <span style="font-size:11.5px;font-weight:700;color:#374151">${escH(type)}</span>
          <span style="background:#e8edf8;color:#6366f1;font-size:10px;font-weight:700;border-radius:10px;padding:1px 8px;margin-left:4px">${grouped[brand][type].length}</span>
        </div>
        <!-- Model rows -->
        <div style="background:#fff">
          ${grouped[brand][type].map((r, ri) => `
          <div class="kit-row-item" style="display:flex;align-items:center;gap:12px;padding:11px 18px;
                      ${ri < grouped[brand][type].length - 1 ? 'border-bottom:1px solid #f1f5f9;' : ''}">

            <!-- Index badge + model name -->
            <div style="width:22px;height:22px;border-radius:6px;background:#eef2ff;color:#6366f1;
                        font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${ri+1}</div>
            <div style="flex:1;font-size:13px;font-weight:600;color:#1e293b;letter-spacing:0.1px">${escH(r.model)}</div>

            <!-- Picture -->
            <div style="display:flex;align-items:center;gap:6px">
              <input type="file" accept="image/*" id="kit-img-${r.id}" style="display:none"
                     onchange="window._kitImgUpload('${r.id}',this)">
              ${r.detail_image_url
                ? `<span class="kit-chip-has-img" onclick="document.getElementById('kit-img-${r.id}').click()" title="เปลี่ยนรูป"
                    style="background:linear-gradient(135deg,#d1fae5,#a7f3d0);color:#065f46;border:1px solid #6ee7b7;border-radius:8px;
                           padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:4px">
                    <span style="font-size:12px">✓</span> มีรูป
                  </span>
                  <button onclick="window._kitImgClear('${r.id}')" title="ลบรูป"
                    style="background:#fee2e2;color:#ef4444;border:none;border-radius:7px;
                           width:28px;height:28px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;
                           transition:transform .12s"
                    onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">✕</button>`
                : `<button class="kit-btn-upload" onclick="document.getElementById('kit-img-${r.id}').click()"
                    style="background:#f8fafc;color:#94a3b8;border:1.5px dashed #cbd5e1;border-radius:8px;
                           padding:5px 12px;font-size:11px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:4px">
                    <span style="font-size:14px;line-height:1">+</span> อัพโหลดรูป
                  </button>`}
            </div>

            <!-- Delete -->
            <button class="kit-btn-del" onclick="window._kitDelete('${r.id}')"
              style="background:#fff;color:#94a3b8;border:1.5px solid #e2e8f0;border-radius:8px;
                     padding:5px 13px;cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap">
              ลบ
            </button>
          </div>`).join('')}
        </div>`;
    }
    html += `</div>`;
  }

  const el = document.getElementById('kit-mgr-table');
  if (el) el.innerHTML = html || `
    <div style="text-align:center;padding:52px 20px">
      <div style="font-size:48px;margin-bottom:12px;opacity:.6">🔌</div>
      <div style="color:#6366f1;font-size:14px;font-weight:700;margin-bottom:4px">ยังไม่มีข้อมูล Kit</div>
      <div style="color:#94a3b8;font-size:12px">กรอกข้อมูลด้านบนแล้วกดเพิ่มเพื่อเริ่มต้น</div>
    </div>`;
}

window._kitAdd = async function () {
  const brand = document.getElementById('kit-add-brand')?.value.trim();
  const type  = document.getElementById('kit-add-type')?.value.trim();
  const model = document.getElementById('kit-add-model')?.value.trim();
  if (!brand || !type || !model) return alert('กรุณากรอกข้อมูลให้ครบ');
  try {
    await addKitRow(brand, type, model);
    document.getElementById('kit-add-model').value = '';
    renderKitMgrTable();
    _syncAndRenderFeeders();
  } catch(e) { alert('เกิดข้อผิดพลาด: ' + e.message); }
};

window._kitImgUpload = async function (id, input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];
  const ext  = file.name.split('.').pop() || 'jpg';
  const path = `kit-catalogue/${id}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (error) return alert('อัพโหลดรูปล้มเหลว: ' + error.message);
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  const url = data.publicUrl;
  const { error: e2 } = await sb.from('kit_catalogue').update({ detail_image_url: url }).eq('id', id);
  if (e2) return alert('บันทึก URL ล้มเหลว: ' + e2.message);
  const row = kitRows.find(r => r.id === id);
  if (row) row.detail_image_url = url;
  renderKitMgrTable();
};

window._kitImgClear = async function (id) {
  const ok = await window.appConfirm({ title:'ลบรูป', message:'ยืนยันลบรูปนี้?', okText:'ลบ', okColor:'#ef4444' });
  if (!ok) return;
  const { error } = await sb.from('kit_catalogue').update({ detail_image_url: null }).eq('id', id);
  if (error) return alert('เกิดข้อผิดพลาด: ' + error.message);
  const row = kitRows.find(r => r.id === id);
  if (row) row.detail_image_url = null;
  renderKitMgrTable();
};

window._kitDelete = async function (id) {
  const ok = await window.appConfirm({ title:'ลบรุ่น', message:'ยืนยันลบรุ่นนี้?', okText:'ลบ', okColor:'#ef4444' });
  if (!ok) return;
  try {
    await deleteKitRow(id);
    renderKitMgrTable();
    _syncAndRenderFeeders();
  } catch(e) { alert('เกิดข้อผิดพลาด: ' + e.message); }
};

window._openKitMgr = function () {
  injectKitModal();
  document.getElementById('modal-kit-mgr').classList.add('open');
  renderKitMgrTable();
};

// ── Init ──────────────────────────────────────────────────────
window._termInit = async function () {
  injectModal();
  try {
    const [recs, jobs, _kits] = await Promise.all([
      listRecords(),
      sb.from('jobs').select('*').eq('is_active', true).order('job_name'),
      loadKitCatalogue(),
    ]);
    records   = recs;
    jobsCache = jobs.data || [];
  } catch (e) {
    records   = [];
    jobsCache = [];
  }
  renderTab();
};
