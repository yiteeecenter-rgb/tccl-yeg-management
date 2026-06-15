export function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

export function formatDateTH(val){
  if(!val) return '';
  const [y,m,d] = String(val).split('-');
  if(!y||!m||!d) return val;
  const months=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${parseInt(d)} ${months[parseInt(m)-1]} ${parseInt(y)+543}`;
}

export function formatMoney(n){
  return (parseFloat(n)||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
}

export function showToast(msg, type=''){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' '+type : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=> t.classList.remove('show'), 3500);
}

export function showLoading(msg='กำลังโหลด...'){
  let el = document.getElementById('loading-overlay');
  if(!el){
    el = document.createElement('div');
    el.id = 'loading-overlay';
    el.className = 'loading-overlay';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="spinner"></div>${msg}`;
  el.style.display = 'flex';
}

export function hideLoading(){
  const el = document.getElementById('loading-overlay');
  if(el) el.style.display = 'none';
}

export function compressImage(dataUrl, maxDim, quality){
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export function genDocNo(){
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth()+1).padStart(2,'0');
  const d = String(now.getDate()).padStart(2,'0');
  const rand = String(Math.floor(Math.random()*9000)+1000);
  return `PC-${y}${m}${d}-${rand}`;
}

export const MILE_RATE = 5;

export function calcTripTotal(trip){
  let total = 0;
  if(trip.mileage?.on){
    const km = Math.max(0,(parseFloat(trip.mileage.end)||0)-(parseFloat(trip.mileage.start)||0));
    total += km * MILE_RATE;
  }
  if(trip.toll?.on) total += parseFloat(trip.toll.amount)||0;
  (trip.purchases||[]).forEach(p => total += parseFloat(p.amount)||0);
  (trip.others||[]).forEach(o => total += parseFloat(o.amount)||0);
  return total;
}
