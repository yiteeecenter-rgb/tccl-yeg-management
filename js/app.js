import { saveRecord, updateRecord, deleteRecord, getRecord, getAllRecords, getUnits, saveUnit, updateUnit, deleteUnit, getStations, saveStation, updateStation, deleteStation, uploadPhoto } from './firebase.js';
import { esc, formatDateTH, formatMoney, showToast, showLoading, hideLoading, compressImage, genDocNo, calcTripTotal, MILE_RATE } from './utils.js';
import { doPrint } from './print.js';

// ── STATE ────────────────────────────────────────────────────
let _units    = [];
let _stations = [];
let _trips    = [];
let _tripCnt  = 0;
let _editId   = null;   // Firestore doc ID when editing
let _histRows = [];

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('f-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('f-docno').value = genDocNo();
  addTrip();
  await loadFormData();
  switchTab('form');
  document.getElementById('tab-form').querySelector('.tab-btn').classList.add('active');
});

async function loadFormData(){
  try {
    _units    = await getUnits();
    _stations = await getStations();
    populateCompanyDropdown();
    _trips.forEach(t => refreshTripDropdowns(t.id));
  } catch(e){ console.error(e); }
}

// ── TABS ─────────────────────────────────────────────────────
window.switchTab = function(tab) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
  if(tab === 'history') loadHistory();
  if(tab === 'manage')  renderManage();
};

// ── COMPANY DROPDOWN ─────────────────────────────────────────
function populateCompanyDropdown(){
  const sel = document.getElementById('f-company');
  const companies = [...new Set(_units.map(u => u.company).filter(Boolean))];
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- เลือกบริษัท --</option>';
  companies.forEach(c => { sel.innerHTML += `<option value="${esc(c)}">${esc(c)}</option>`; });
  if(companies.includes(cur)) sel.value = cur;
  _trips.forEach(t => refreshTripDropdowns(t.id));
}

window.onCompanyChange = () => { _trips.forEach(t => refreshTripDropdowns(t.id)); };

// ── TRIPS ─────────────────────────────────────────────────────
function getTripById(id){ return _trips.find(t => t.id === id) || null; }

window.addTrip = function(){
  _tripCnt++;
  const id = _tripCnt;
  _trips.push({ id, date:'', unitId:'', stationId:'', stationName:'', jobNo:'',
    linePhoto:null, lineThumb:null, lineImgUrl:'',
    mileage:{ on:false, start:'', end:'', imgBefore:null, imgBeforeThumb:null, imgBefore_url:'', imgAfter:null, imgAfterThumb:null, imgAfter_url:'' },
    toll:{ on:false, amount:'' }, purchases:[], others:[] });
  const div = document.createElement('div');
  div.className = 'trip-card';
  div.id = 'trip-card-' + id;
  div.innerHTML = makeTripHTML(id);
  document.getElementById('trips-container').appendChild(div);
  attachPhoto('line-inp-'+id, 'line-prev-'+id, id, 'line');
  attachPhoto('mb-inp-'+id,   'mb-prev-'+id,   id, 'mb');
  attachPhoto('ma-inp-'+id,   'ma-prev-'+id,   id, 'ma');
  refreshTripDropdowns(id);
};

window.removeTrip = function(id){
  if(_trips.length <= 1){ showToast('ต้องมีอย่างน้อย 1 ทริป','error'); return; }
  _trips = _trips.filter(t => t.id !== id);
  document.getElementById('trip-card-'+id)?.remove();
  calcGrandTotal();
};

function makeTripHTML(id){
  return `
  <div class="trip-head">
    <span>🚗 ทริป #${id}</span>
    <button class="btn btn-sm btn-outline no-print" onclick="removeTrip(${id})" style="margin-left:auto">✕ ลบทริปนี้</button>
  </div>
  <div class="trip-body">
    <div class="form-row">
      <div class="form-group">
        <label>วันที่</label>
        <input type="date" id="td-${id}" oninput="calcGrandTotal()">
      </div>
      <div class="form-group">
        <label>หน่วยงาน</label>
        <select id="unit-sel-${id}" onchange="onUnitChange(${id})"><option value="">-- เลือก --</option></select>
      </div>
      <div class="form-group">
        <label>สถานี</label>
        <select id="sta-sel-${id}" onchange="onStaChange(${id})"><option value="">-- เลือก --</option></select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Job No.</label>
        <input type="text" id="jobno-${id}" readonly style="background:#f5f5f5" placeholder="อัตโนมัติ">
      </div>
      <div class="form-group" style="flex:2">
        <label>รายละเอียดทริป</label>
        <input type="text" id="detail-${id}" oninput="calcGrandTotal()" placeholder="เช่น ไปประชุมที่...">
      </div>
    </div>

    <!-- Line photo -->
    <div class="trip-section">
      <div class="trip-section-title">📸 รูป LINE อนุมัติ</div>
      <div class="photo-row">
        <div class="photo-box">
          <div class="photo-preview" onclick="document.getElementById('line-inp-${id}').click()">
            <span class="ph-icon" id="line-prev-${id}">📷</span>
          </div>
          <input type="file" class="photo-input" id="line-inp-${id}" accept="image/*">
        </div>
      </div>
    </div>

    <!-- Mileage -->
    <div class="trip-section">
      <div class="toggle-row">
        <input type="checkbox" id="mile-on-${id}" onchange="toggleMile(${id})">
        <label for="mile-on-${id}"><strong>มีค่าเดินทาง (ไมล์เรท ${MILE_RATE} บ./กม.)</strong></label>
      </div>
      <div class="toggle-content" id="mile-block-${id}">
        <div class="form-row">
          <div class="form-group"><label>มิเตอร์เริ่มต้น (กม.)</label><input type="number" id="ms-${id}" oninput="calcGrandTotal()" min="0"></div>
          <div class="form-group"><label>มิเตอร์สิ้นสุด (กม.)</label><input type="number" id="me-${id}" oninput="calcGrandTotal()" min="0"></div>
          <div class="form-group"><label>ระยะทาง</label><input type="text" id="md-${id}" readonly style="background:#f5f5f5"></div>
          <div class="form-group"><label>ค่าเดินทาง</label><input type="text" id="ma-amt-${id}" readonly style="background:#e8f5e9;color:#2e7d32;font-weight:700"></div>
        </div>
        <div class="photo-row">
          <div class="photo-box"><label>มิเตอร์ก่อน</label>
            <div class="photo-preview" onclick="document.getElementById('mb-inp-${id}').click()"><span class="ph-icon" id="mb-prev-${id}">📷</span></div>
            <input type="file" class="photo-input" id="mb-inp-${id}" accept="image/*">
          </div>
          <div class="photo-box"><label>มิเตอร์หลัง</label>
            <div class="photo-preview" onclick="document.getElementById('ma-inp-${id}').click()"><span class="ph-icon" id="ma-prev-${id}">📷</span></div>
            <input type="file" class="photo-input" id="ma-inp-${id}" accept="image/*">
          </div>
        </div>
      </div>
    </div>

    <!-- Toll -->
    <div class="trip-section">
      <div class="toggle-row">
        <input type="checkbox" id="toll-on-${id}" onchange="toggleToll(${id})">
        <label for="toll-on-${id}"><strong>มีค่าทางด่วน</strong></label>
      </div>
      <div class="toggle-content" id="toll-block-${id}">
        <div class="form-group" style="max-width:200px"><label>จำนวนเงิน (บาท)</label>
          <input type="number" id="toll-${id}" oninput="calcGrandTotal()" min="0" step="0.01">
        </div>
      </div>
    </div>

    <!-- Purchases -->
    <div class="trip-section">
      <div class="toggle-row">
        <input type="checkbox" id="pur-on-${id}" onchange="togglePur(${id})">
        <label for="pur-on-${id}"><strong>มีค่าซื้อของ/เบิกของ</strong></label>
      </div>
      <div class="toggle-content" id="pur-block-${id}">
        <div id="pur-list-${id}"></div>
        <button class="btn btn-sm btn-outline" onclick="addExpense('pur','${id}')">+ เพิ่มรายการ</button>
      </div>
    </div>

    <!-- Others -->
    <div class="trip-section">
      <div class="toggle-row">
        <input type="checkbox" id="oth-on-${id}" onchange="toggleOth(${id})">
        <label for="oth-on-${id}"><strong>ค่าใช้จ่ายอื่นๆ</strong></label>
      </div>
      <div class="toggle-content" id="oth-block-${id}">
        <div id="oth-list-${id}"></div>
        <button class="btn btn-sm btn-outline" onclick="addExpense('oth','${id}')">+ เพิ่มรายการ</button>
      </div>
    </div>

    <div class="trip-subtotal">รวมทริปนี้: <span id="trip-tot-${id}">฿ 0.00</span></div>
  </div>`;
}

// Toggles
window.toggleMile = id => { const el=document.getElementById('mile-block-'+id); el.classList.toggle('show',document.getElementById('mile-on-'+id).checked); calcGrandTotal(); };
window.toggleToll = id => { const el=document.getElementById('toll-block-'+id); el.classList.toggle('show',document.getElementById('toll-on-'+id).checked); calcGrandTotal(); };
window.togglePur  = id => { const el=document.getElementById('pur-block-'+id);  el.classList.toggle('show',document.getElementById('pur-on-'+id).checked);  calcGrandTotal(); };
window.toggleOth  = id => { const el=document.getElementById('oth-block-'+id);  el.classList.toggle('show',document.getElementById('oth-on-'+id).checked);  calcGrandTotal(); };

// Dropdowns
function refreshTripDropdowns(id){
  const company = document.getElementById('f-company')?.value || '';
  const units = company ? _units.filter(u => u.company === company) : _units;
  const uSel = document.getElementById('unit-sel-'+id);
  if(!uSel) return;
  const curU = uSel.value;
  uSel.innerHTML = '<option value="">-- เลือกหน่วยงาน --</option>';
  units.forEach(u => uSel.innerHTML += `<option value="${esc(u.unitId)}">${esc(u.unitId)} - ${esc(u.unitName)}</option>`);
  if(curU) uSel.value = curU;
  refreshStaDropdown(id, document.getElementById('sta-sel-'+id)?.value || '');
}

function refreshStaDropdown(id, selSta=''){
  const unitId = document.getElementById('unit-sel-'+id)?.value || '';
  const stas = unitId ? _stations.filter(s => s.unitId === unitId) : [];
  const sSel = document.getElementById('sta-sel-'+id);
  if(!sSel) return;
  sSel.innerHTML = '<option value="">-- เลือกสถานี --</option>';
  stas.forEach(s => sSel.innerHTML += `<option value="${esc(s.stationId)}">${esc(s.stationName||s.stationId)}</option>`);
  if(selSta) sSel.value = selSta;
}

window.onUnitChange = id => {
  const trip = getTripById(id);
  if(trip) trip.unitId = document.getElementById('unit-sel-'+id).value;
  refreshStaDropdown(id);
  const trip2 = getTripById(id);
  if(trip2){ trip2.stationId=''; trip2.stationName=''; trip2.jobNo=''; }
  if(document.getElementById('jobno-'+id)) document.getElementById('jobno-'+id).value = '';
};

window.onStaChange = id => {
  const staId = document.getElementById('sta-sel-'+id)?.value || '';
  const sta = _stations.find(s => s.stationId === staId) || null;
  const trip = getTripById(id);
  if(trip){ trip.stationId=sta?.stationId||''; trip.stationName=sta?.stationName||''; trip.jobNo=sta?.jobNo||''; }
  const jEl = document.getElementById('jobno-'+id);
  if(jEl) jEl.value = sta?.jobNo || '';
};

// Expenses
window.addExpense = function(type, id){
  const list = document.getElementById(type+'-list-'+id);
  const div  = document.createElement('div');
  div.className = 'expense-item';
  div.innerHTML = `<input type="text" placeholder="รายละเอียด" oninput="calcGrandTotal()">
    <input type="number" placeholder="บาท" min="0" step="0.01" oninput="calcGrandTotal()">
    <button class="btn-remove" onclick="this.parentElement.remove();calcGrandTotal()">×</button>`;
  list.appendChild(div);
};

// ── CALC TOTAL ────────────────────────────────────────────────
window.calcGrandTotal = function(){
  let grand = 0;
  _trips.forEach(trip => {
    const id = trip.id;
    const mOn = document.getElementById('mile-on-'+id)?.checked;
    const tOn = document.getElementById('toll-on-'+id)?.checked;
    let sub = 0;
    if(mOn){
      const s = parseFloat(document.getElementById('ms-'+id)?.value)||0;
      const e = parseFloat(document.getElementById('me-'+id)?.value)||0;
      const km = Math.max(0,e-s);
      sub += km * MILE_RATE;
      if(document.getElementById('md-'+id)) document.getElementById('md-'+id).value = km + ' กม.';
      if(document.getElementById('ma-amt-'+id)) document.getElementById('ma-amt-'+id).value = '฿ ' + formatMoney(km*MILE_RATE);
    }
    if(tOn) sub += parseFloat(document.getElementById('toll-'+id)?.value)||0;
    document.getElementById('pur-list-'+id)?.querySelectorAll('.expense-item').forEach(item => {
      sub += parseFloat(item.querySelectorAll('input')[1]?.value)||0;
    });
    document.getElementById('oth-list-'+id)?.querySelectorAll('.expense-item').forEach(item => {
      sub += parseFloat(item.querySelectorAll('input')[1]?.value)||0;
    });
    grand += sub;
    const el = document.getElementById('trip-tot-'+id);
    if(el) el.textContent = '฿ ' + formatMoney(sub);
  });
  const gel = document.getElementById('grand-total');
  if(gel) gel.textContent = '฿ ' + formatMoney(grand);
};

// ── PHOTOS ────────────────────────────────────────────────────
function attachPhoto(inputId, prevId, tripId, field){
  const inp = document.getElementById(inputId);
  if(!inp) return;
  inp.addEventListener('change', async function(){
    const file = this.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async e => {
      const orig  = e.target.result;
      const full  = await compressImage(orig, 1000, 0.75);
      const thumb = await compressImage(orig, 500,  0.5);
      const trip  = getTripById(tripId);
      if(!trip) return;
      if(field === 'line'){ trip.linePhoto = full; trip.lineThumb = thumb; }
      else if(field === 'mb'){ trip.mileage.imgBefore = full; trip.mileage.imgBeforeThumb = thumb; }
      else if(field === 'ma'){ trip.mileage.imgAfter  = full; trip.mileage.imgAfterThumb  = thumb; }
      const prev = document.getElementById(prevId);
      if(prev) prev.innerHTML = `<img src="${thumb}" style="width:100%;height:100%;object-fit:cover">`;
    };
    reader.readAsDataURL(file);
  });
}

// ── COLLECT DATA ─────────────────────────────────────────────
function collectData(){
  return {
    docNo:       document.getElementById('f-docno').value.trim(),
    date:        document.getElementById('f-date').value,
    submittedBy: document.getElementById('f-name').value.trim(),
    company:     document.getElementById('f-company').value,
    section:     document.getElementById('f-section').value.trim(),
    department:  document.getElementById('f-dept').value.trim(),
    purpose:     document.getElementById('f-purpose').value.trim(),
    trips: _trips.map(trip => {
      const id = trip.id;
      const mOn = document.getElementById('mile-on-'+id)?.checked || false;
      const tOn = document.getElementById('toll-on-'+id)?.checked || false;
      const purchases = [];
      document.getElementById('pur-list-'+id)?.querySelectorAll('.expense-item').forEach(item => {
        const ins = item.querySelectorAll('input');
        if(ins[0]?.value) purchases.push({ desc: ins[0].value, amount: parseFloat(ins[1]?.value)||0 });
      });
      const others = [];
      document.getElementById('oth-list-'+id)?.querySelectorAll('.expense-item').forEach(item => {
        const ins = item.querySelectorAll('input');
        if(ins[0]?.value) others.push({ desc: ins[0].value, amount: parseFloat(ins[1]?.value)||0 });
      });
      return {
        date:       document.getElementById('td-'+id)?.value || '',
        unitId:     document.getElementById('unit-sel-'+id)?.value || '',
        stationId:  trip.stationId, stationName: trip.stationName, jobNo: trip.jobNo,
        detail:     document.getElementById('detail-'+id)?.value || '',
        linePhoto:  trip.linePhoto  || null,
        lineThumb:  trip.lineThumb  || '',
        lineImgUrl: trip.lineImgUrl || '',
        mileage: { on:mOn,
          start: mOn?(parseFloat(document.getElementById('ms-'+id)?.value)||0):0,
          end:   mOn?(parseFloat(document.getElementById('me-'+id)?.value)||0):0,
          imgBefore: mOn?(trip.mileage.imgBefore||null):null,
          imgBeforeThumb: mOn?(trip.mileage.imgBeforeThumb||''):'',
          imgBefore_url:  mOn?(trip.mileage.imgBefore_url||''):'',
          imgAfter:  mOn?(trip.mileage.imgAfter||null):null,
          imgAfterThumb:  mOn?(trip.mileage.imgAfterThumb||''):'',
          imgAfter_url:   mOn?(trip.mileage.imgAfter_url||''):''
        },
        toll:      { on:tOn, amount: tOn?(parseFloat(document.getElementById('toll-'+id)?.value)||0):0 },
        purchases, others
      };
    })
  };
}

// ── SUBMIT ────────────────────────────────────────────────────
window.doSubmit = async function(){
  const d = collectData();
  if(!d.docNo){ showToast('กรุณาระบุเลขที่ใบเบิก','error'); return; }
  if(!d.submittedBy){ showToast('กรุณาระบุชื่อผู้เบิก','error'); return; }

  showLoading(_editId ? 'กำลังอัพเดท...' : 'กำลังบันทึก...');
  try {
    // Upload photos to Firebase Storage
    const recordId = _editId || 'temp-' + Date.now();
    for(let i = 0; i < d.trips.length; i++){
      const t = d.trips[i];
      if(t.linePhoto?.startsWith('data:')){
        t.lineImgUrl = await uploadPhoto(recordId, i, 'line', t.linePhoto);
        t.linePhoto  = null; // don't store full base64 in Firestore
      }
      if(t.mileage.imgBefore?.startsWith('data:')){
        t.mileage.imgBefore_url = await uploadPhoto(recordId, i, 'mb', t.mileage.imgBefore);
        t.mileage.imgBefore = null;
      }
      if(t.mileage.imgAfter?.startsWith('data:')){
        t.mileage.imgAfter_url = await uploadPhoto(recordId, i, 'ma', t.mileage.imgAfter);
        t.mileage.imgAfter = null;
      }
    }

    const total = d.trips.reduce((s,t) => s + calcTripTotal(t), 0);
    const payload = { ...d, totalAmount: total };

    if(_editId){
      await updateRecord(_editId, payload);
      showToast('อัพเดทสำเร็จ ✓','success');
      cancelEdit();
    } else {
      await saveRecord(payload);
      showToast('บันทึกสำเร็จ ✓','success');
      resetForm();
    }
  } catch(e){
    console.error(e);
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
};

// ── FORM RESET ────────────────────────────────────────────────
function resetForm(){
  document.getElementById('f-docno').value    = genDocNo();
  document.getElementById('f-date').value     = new Date().toISOString().slice(0,10);
  document.getElementById('f-name').value     = '';
  document.getElementById('f-company').value  = '';
  document.getElementById('f-section').value  = '';
  document.getElementById('f-dept').value     = '';
  document.getElementById('f-purpose').value  = '';
  document.getElementById('trips-container').innerHTML = '';
  _trips = []; _tripCnt = 0;
  addTrip();
  calcGrandTotal();
}

// ── EDIT MODE ─────────────────────────────────────────────────
async function openEdit(id){
  showLoading('กำลังโหลดข้อมูล...');
  try {
    const rec = await getRecord(id);
    if(!rec){ showToast('ไม่พบข้อมูล','error'); return; }
    _editId = id;
    fillForm(rec);
    switchTab('form');
    document.getElementById('edit-banner').style.display = 'flex';
    document.getElementById('edit-label').textContent = rec.docNo || id;
    document.getElementById('submit-btn').textContent = '💾 อัพเดทใบเบิก';
  } catch(e){ showToast(e.message,'error'); }
  finally { hideLoading(); }
}

function fillForm(rec){
  document.getElementById('f-docno').value    = rec.docNo    || '';
  document.getElementById('f-date').value     = rec.date     || '';
  document.getElementById('f-name').value     = rec.submittedBy || '';
  document.getElementById('f-company').value  = rec.company  || '';
  document.getElementById('f-section').value  = rec.section  || '';
  document.getElementById('f-dept').value     = rec.department || '';
  document.getElementById('f-purpose').value  = rec.purpose  || '';

  document.getElementById('trips-container').innerHTML = '';
  _trips = []; _tripCnt = 0;

  const trips = rec.trips?.length ? rec.trips : [{}];
  trips.forEach(t => {
    addTrip();
    const id = _tripCnt;
    const trip = getTripById(id);

    document.getElementById('td-'+id).value = t.date || '';
    document.getElementById('detail-'+id).value = t.detail || '';

    // Unit/Station
    const uSel = document.getElementById('unit-sel-'+id);
    if(uSel){ uSel.value = t.unitId||''; trip.unitId = t.unitId||''; }
    refreshStaDropdown(id, t.stationId||'');
    trip.stationId = t.stationId||''; trip.stationName = t.stationName||''; trip.jobNo = t.jobNo||'';
    if(document.getElementById('jobno-'+id)) document.getElementById('jobno-'+id).value = t.jobNo||'';

    // Preserve URLs and thumbs
    trip.lineImgUrl = t.lineImgUrl || '';
    trip.lineThumb  = t.lineThumb  || '';
    if(t.mileage){ trip.mileage.imgBefore_url = t.mileage.imgBefore_url||''; trip.mileage.imgAfter_url = t.mileage.imgAfter_url||''; trip.mileage.imgBeforeThumb = t.mileage.imgBeforeThumb||''; trip.mileage.imgAfterThumb = t.mileage.imgAfterThumb||''; }

    // Show photo previews
    const IS = 'width:100%;height:100%;object-fit:cover';
    const BADGE = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#2e7d32;font-size:11px;gap:2px"><span style="font-size:22px">✅</span>มีรูปในระบบ</div>';
    const lp = document.getElementById('line-prev-'+id);
    if(lp && t.lineThumb) lp.innerHTML = `<img src="${t.lineThumb}" style="${IS}">`;
    else if(lp && t.lineImgUrl) lp.innerHTML = BADGE;
    const mbp = document.getElementById('mb-prev-'+id);
    if(mbp && t.mileage?.imgBeforeThumb) mbp.innerHTML = `<img src="${t.mileage.imgBeforeThumb}" style="${IS}">`;
    else if(mbp && t.mileage?.imgBefore_url) mbp.innerHTML = BADGE;
    const map2 = document.getElementById('ma-prev-'+id);
    if(map2 && t.mileage?.imgAfterThumb) map2.innerHTML = `<img src="${t.mileage.imgAfterThumb}" style="${IS}">`;
    else if(map2 && t.mileage?.imgAfter_url) map2.innerHTML = BADGE;

    // Mileage
    if(t.mileage?.on){
      const mCb = document.getElementById('mile-on-'+id);
      if(mCb){ mCb.checked = true; document.getElementById('mile-block-'+id)?.classList.add('show'); }
      document.getElementById('ms-'+id).value = t.mileage.start||'';
      document.getElementById('me-'+id).value = t.mileage.end||'';
    }
    // Toll
    if(t.toll?.on){
      const tCb = document.getElementById('toll-on-'+id);
      if(tCb){ tCb.checked = true; document.getElementById('toll-block-'+id)?.classList.add('show'); }
      document.getElementById('toll-'+id).value = t.toll.amount||'';
    }
    // Purchases
    if(t.purchases?.length){
      const pCb = document.getElementById('pur-on-'+id);
      if(pCb){ pCb.checked = true; document.getElementById('pur-block-'+id)?.classList.add('show'); }
      const pList = document.getElementById('pur-list-'+id);
      pList.innerHTML = '';
      t.purchases.forEach(p => {
        const div = document.createElement('div'); div.className = 'expense-item';
        div.innerHTML = `<input type="text" value="${esc(p.desc||'')}" oninput="calcGrandTotal()"><input type="number" value="${p.amount||0}" oninput="calcGrandTotal()"><button class="btn-remove" onclick="this.parentElement.remove();calcGrandTotal()">×</button>`;
        pList.appendChild(div);
      });
    }
    // Others
    if(t.others?.length){
      const oCb = document.getElementById('oth-on-'+id);
      if(oCb){ oCb.checked = true; document.getElementById('oth-block-'+id)?.classList.add('show'); }
      const oList = document.getElementById('oth-list-'+id);
      oList.innerHTML = '';
      t.others.forEach(o => {
        const div = document.createElement('div'); div.className = 'expense-item';
        div.innerHTML = `<input type="text" value="${esc(o.desc||'')}" oninput="calcGrandTotal()"><input type="number" value="${o.amount||0}" oninput="calcGrandTotal()"><button class="btn-remove" onclick="this.parentElement.remove();calcGrandTotal()">×</button>`;
        oList.appendChild(div);
      });
    }
  });
  calcGrandTotal();
}

window.cancelEdit = function(){
  _editId = null;
  document.getElementById('edit-banner').style.display = 'none';
  document.getElementById('submit-btn').textContent = '💾 บันทึกใบเบิก';
  resetForm();
};

// ── HISTORY ───────────────────────────────────────────────────
async function loadHistory(){
  const body = document.getElementById('history-body');
  body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px"><div class="spinner"></div> กำลังโหลด...</td></tr>';
  try {
    const rows = await getAllRecords();
    _histRows = rows;
    if(!rows.length){ body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888;padding:20px">ไม่มีข้อมูล</td></tr>'; return; }
    body.innerHTML = rows.map(r => {
      const status = r.status || 'pending';
      const badge = { pending:'<span class="badge badge-pending">รออนุมัติ</span>', approved:'<span class="badge badge-approved">อนุมัติ</span>', rejected:'<span class="badge badge-rejected">ปฏิเสธ</span>', paid:'<span class="badge badge-paid">จ่ายแล้ว</span>' }[status] || status;
      return `<tr>
        <td>${esc(r.docNo||r.id)}</td>
        <td>${formatDateTH(r.date)}</td>
        <td>${esc(r.submittedBy||'')}</td>
        <td style="text-align:right">฿${formatMoney(r.totalAmount)}</td>
        <td>${badge}</td>
        <td>
          <button class="btn btn-sm btn-outline btn-icon" onclick="openEdit('${r.id}')" title="แก้ไข">✏️</button>
          <button class="btn btn-sm btn-outline btn-icon" onclick="printRecord('${r.id}')" title="พิมพ์">🖨️</button>
          ${status==='paid'
            ? `<button class="btn btn-sm btn-outline btn-icon" onclick="markPaid('${r.id}',false)" title="ยกเลิกรับเงิน">↩️</button>`
            : `<button class="btn btn-sm btn-outline btn-icon" onclick="markPaid('${r.id}',true)" title="รับเงินแล้ว">💰</button>`}
          <button class="btn btn-sm btn-danger btn-icon" onclick="delRecord('${r.id}')" title="ลบ">🗑️</button>
        </td>
      </tr>`;
    }).join('');
  } catch(e){ body.innerHTML = `<tr><td colspan="7" style="color:red;padding:12px">${e.message}</td></tr>`; }
}

window.delRecord = async function(id){
  if(!confirm('ลบรายการนี้? ไม่สามารถกู้คืนได้')) return;
  showLoading('กำลังลบ...');
  try { await deleteRecord(id); showToast('ลบสำเร็จ','success'); loadHistory(); }
  catch(e){ showToast(e.message,'error'); }
  finally { hideLoading(); }
};

window.markPaid = async function(id, paid){
  showLoading('');
  try {
    const rec = await getRecord(id);
    const status = paid ? 'paid' : (rec?.status === 'paid' ? 'approved' : rec?.status || 'pending');
    await updateRecord(id, { status });
    showToast(paid ? 'บันทึกรับเงินแล้ว ✓' : 'ยกเลิกรับเงินแล้ว ✓', 'success');
    loadHistory();
  } catch(e){ showToast(e.message,'error'); }
  finally { hideLoading(); }
};

window.printRecord = async function(id){
  showLoading('กำลังโหลดข้อมูล...');
  try {
    const rec = await getRecord(id);
    if(!rec){ showToast('ไม่พบข้อมูล','error'); return; }
    hideLoading();
    doPrint(rec);
  } catch(e){ showToast(e.message,'error'); hideLoading(); }
};

window.doPrintForm = function(){
  const d = collectData();
  doPrint(d);
};

// ── MANAGE UNITS & STATIONS ───────────────────────────────────
let _manageTab = 'units';
window.showManageTab = t => { _manageTab = t; renderManage(); document.querySelectorAll('.sub-tab').forEach(b => b.classList.toggle('active', b.dataset.tab===t)); };

async function renderManage(){
  if(_manageTab === 'units') renderUnits();
  else renderStations();
}

function renderUnits(){
  const body = document.getElementById('units-body');
  if(!body) return;
  body.innerHTML = _units.length
    ? _units.map((u,i) => `<tr><td>${esc(u.unitId)}</td><td>${esc(u.unitName)}</td><td>${esc(u.company)}</td><td>
        <button class="btn btn-sm btn-outline" onclick="editUnit(${i})">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="doDeleteUnit('${u.id}')">🗑️</button>
      </td></tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;color:#888;padding:16px">ยังไม่มีข้อมูล</td></tr>';
}

function renderStations(){
  const body = document.getElementById('sta-body');
  if(!body) return;
  body.innerHTML = _stations.length
    ? _stations.map((s,i) => `<tr><td>${esc(s.stationId)}</td><td>${esc(s.stationName)}</td><td>${esc(s.unitId)}</td><td>${esc(s.jobNo)}</td><td>
        <button class="btn btn-sm btn-outline" onclick="editStation(${i})">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="doDeleteSta('${s.id}')">🗑️</button>
      </td></tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center;color:#888;padding:16px">ยังไม่มีข้อมูล</td></tr>';
}

// Unit CRUD
window.openAddUnit = () => openUnitModal();
window.editUnit    = i  => openUnitModal(_units[i], _units[i].id);
function openUnitModal(u={}, id=null){
  document.getElementById('um-id').value      = id || '';
  document.getElementById('um-unitId').value  = u.unitId || '';
  document.getElementById('um-name').value    = u.unitName || '';
  document.getElementById('um-company').value = u.company || '';
  document.getElementById('unit-modal').classList.add('show');
}
window.closeUnitModal = () => document.getElementById('unit-modal').classList.remove('show');
window.saveUnit_ = async () => {
  const id      = document.getElementById('um-id').value;
  const unitId  = document.getElementById('um-unitId').value.trim();
  const name    = document.getElementById('um-name').value.trim();
  const company = document.getElementById('um-company').value.trim();
  if(!unitId||!name||!company){ showToast('กรุณากรอกข้อมูลให้ครบ','error'); return; }
  showLoading('');
  try {
    if(id) await updateUnit(id, { unitId, unitName:name, company });
    else   await saveUnit({ unitId, unitName:name, company });
    _units = await getUnits();
    closeUnitModal();
    renderUnits();
    showToast('บันทึกสำเร็จ ✓','success');
  } catch(e){ showToast(e.message,'error'); }
  finally { hideLoading(); }
};
window.doDeleteUnit = async id => {
  if(!confirm('ลบหน่วยงานนี้?')) return;
  showLoading('');
  try { await deleteUnit(id); _units = await getUnits(); renderUnits(); showToast('ลบสำเร็จ','success'); }
  catch(e){ showToast(e.message,'error'); }
  finally { hideLoading(); }
};

// Station CRUD
window.openAddStation = () => openStaModal();
window.editStation    = i   => openStaModal(_stations[i], _stations[i].id);
function openStaModal(s={}, id=null){
  document.getElementById('sm-id').value    = id || '';
  document.getElementById('sm-sid').value   = s.stationId || '';
  document.getElementById('sm-name').value  = s.stationName || '';
  document.getElementById('sm-unit').value  = s.unitId || '';
  document.getElementById('sm-job').value   = s.jobNo || '';
  document.getElementById('sta-modal').classList.add('show');
}
window.closeStaModal = () => document.getElementById('sta-modal').classList.remove('show');
window.saveStation_ = async () => {
  const id    = document.getElementById('sm-id').value;
  const sid   = document.getElementById('sm-sid').value.trim();
  const name  = document.getElementById('sm-name').value.trim();
  const unit  = document.getElementById('sm-unit').value.trim();
  const job   = document.getElementById('sm-job').value.trim();
  if(!sid||!unit){ showToast('กรุณากรอกรหัสสถานีและหน่วยงาน','error'); return; }
  showLoading('');
  try {
    if(id) await updateStation(id, { stationId:sid, stationName:name, unitId:unit, jobNo:job });
    else   await saveStation({ stationId:sid, stationName:name, unitId:unit, jobNo:job });
    _stations = await getStations();
    closeStaModal();
    renderStations();
    showToast('บันทึกสำเร็จ ✓','success');
  } catch(e){ showToast(e.message,'error'); }
  finally { hideLoading(); }
};
window.doDeleteSta = async id => {
  if(!confirm('ลบสถานีนี้?')) return;
  showLoading('');
  try { await deleteStation(id); _stations = await getStations(); renderStations(); showToast('ลบสำเร็จ','success'); }
  catch(e){ showToast(e.message,'error'); }
  finally { hideLoading(); }
};
