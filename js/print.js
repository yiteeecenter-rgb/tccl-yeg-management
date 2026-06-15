import { esc, formatDateTH, formatMoney, calcTripTotal, MILE_RATE } from './utils.js';

export function buildPrintHTML(d){
  const trips = d.trips || [];
  let html = '';

  // ── PAGE 1: Main sheet ──────────────────────────────────────
  html += `<div class="print-section" style="padding:14mm 16mm;background:#fff;width:210mm;min-height:297mm;box-sizing:border-box">`;

  // Header
  html += `<div style="text-align:right;font-size:10pt;line-height:2;margin-bottom:4pt">
    เลขที่ใบเบิก <span class="print-info-underline" style="min-width:110pt">${esc(d.docNo||'')}</span><br>
    วันที่ <span class="print-info-underline" style="min-width:110pt">${formatDateTH(d.date)}</span>
  </div>
  <div class="print-company">${esc((d.company||'YIPINTSOI ENERGY').toUpperCase())}</div>
  <div style="text-align:center;margin-bottom:12pt">
    <span class="print-title-box">ใบเบิกเงินสดย่อย (PETTY CASH)</span>
  </div>`;

  // Info rows
  const unitId = trips[0]?.unitId || '';
  html += `<table style="width:100%;border-collapse:collapse;margin-bottom:4pt;font-size:10pt"><tr>
    <td>ส่วน <span class="print-info-underline" style="min-width:100pt">${esc(d.section||'')}</span></td>
    <td>ฝ่าย <span class="print-info-underline" style="min-width:100pt">${esc(d.department||'')}</span></td>
    <td>รหัสหน่วยงาน <span class="print-info-underline" style="min-width:80pt">${esc(unitId)}</span></td>
  </tr></table>
  <table style="width:100%;border-collapse:collapse;margin-bottom:10pt;font-size:10pt"><tr>
    <td colspan="2">วัตถุประสงค์ <span class="print-info-underline" style="min-width:180pt">${esc(d.purpose||'')}</span></td>
    <td style="white-space:nowrap">☐ SO <span class="print-info-underline" style="min-width:50pt"></span></td>
    <td style="white-space:nowrap">☐ Project <span class="print-info-underline" style="min-width:50pt"></span></td>
  </tr></table>`;

  // Expense table
  html += `<table class="print-table"><thead><tr>
    <th style="width:70pt">วันที่</th>
    <th>รายการ</th>
    <th style="width:80pt;text-align:right">จำนวนเงิน (บาท)</th>
  </tr></thead><tbody>`;

  let grand = 0;
  trips.forEach(trip => {
    html += `<tr><td colspan="3" style="background:#f5f5f5;font-weight:700">▶ ${esc(trip.stationName||trip.stationId||'—')} ${trip.jobNo?'('+esc(trip.jobNo)+')':''}</td></tr>`;
    const tripTotal = calcTripTotal(trip);
    grand += tripTotal;

    if(trip.mileage?.on){
      const km = Math.max(0,(parseFloat(trip.mileage.end)||0)-(parseFloat(trip.mileage.start)||0));
      html += `<tr><td>${esc(trip.date||'')}</td><td>ค่าไมล์เรท ${km} กม. × ${MILE_RATE} บ./กม.</td><td style="text-align:right">${formatMoney(km*MILE_RATE)}</td></tr>`;
    }
    if(trip.toll?.on){
      html += `<tr><td>${esc(trip.date||'')}</td><td>ค่าทางด่วน</td><td style="text-align:right">${formatMoney(trip.toll.amount)}</td></tr>`;
    }
    (trip.purchases||[]).forEach(p => {
      html += `<tr><td>${esc(trip.date||'')}</td><td>${esc(p.desc)}</td><td style="text-align:right">${formatMoney(p.amount)}</td></tr>`;
    });
    (trip.others||[]).forEach(o => {
      html += `<tr><td>${esc(trip.date||'')}</td><td>${esc(o.desc)}</td><td style="text-align:right">${formatMoney(o.amount)}</td></tr>`;
    });
  });

  html += `<tr><td colspan="2" style="text-align:right;font-weight:700">รวมทั้งสิ้น / Grand Total</td>
    <td style="text-align:right;font-weight:700">${formatMoney(grand)}</td></tr></tbody></table>`;

  // Signature
  html += `<br><table class="sign-table"><tr>
    <td>………………………<br>……/……/……<br><strong>ผู้ขอเบิก</strong></td>
    <td>………………………<br>……/……/……<br><strong>ผู้ตรวจสอบ</strong></td>
    <td>………………………<br>……/……/……<br><strong>ผู้อนุมัติ</strong></td>
    <td>………………………<br>……/……/……<br><strong>ผู้จ่ายเงิน</strong></td>
    <td>………………………<br>……/……/……<br><strong>ผู้รับเงิน</strong></td>
  </tr></table>`;
  html += `</div>`;

  // ── PAGE 2+: Attachments ──────────────────────────────────
  trips.forEach((trip, i) => {
    html += `<div class="print-section" style="padding:14mm 16mm;background:#fff;width:210mm;min-height:297mm;box-sizing:border-box">`;
    html += `<div style="font-size:11pt;font-weight:700;margin-bottom:8pt;padding-bottom:6pt;border-bottom:2px solid #1a3a5c">
      เอกสารแนบ — ${formatDateTH(trip.date)} | ${esc(trip.stationName||'—')} | Job No. ${esc(trip.jobNo||'—')}
    </div>`;

    // Line photo
    html += `<div class="attach-sec"><div class="attach-sec-title">ส่วนที่ 1 — LINE อนุมัติ</div><div>`;
    const lineSrc = trip.linePhoto || trip.lineThumb || '';
    if(lineSrc){
      html += `<div class="attach-photo-wrap"><div class="attach-photo"><img src="${lineSrc}"></div></div>`;
    } else {
      html += `<span class="attach-empty">ไม่มีรูป Line อนุมัติ</span>`;
    }
    html += `</div></div>`;

    // Mileage photos
    html += `<div class="attach-sec"><div class="attach-sec-title">ส่วนที่ 2 — มิเตอร์รถยนต์ (ไมล์เรท)</div><div>`;
    if(trip.mileage?.on){
      const km = Math.max(0,(parseFloat(trip.mileage.end)||0)-(parseFloat(trip.mileage.start)||0));
      const mbSrc = trip.mileage.imgBefore || trip.mileage.imgBeforeThumb || '';
      const maSrc = trip.mileage.imgAfter  || trip.mileage.imgAfterThumb  || '';
      html += `<div class="attach-photo-wrap">
        <div style="font-size:10pt;color:#555;margin-bottom:4pt">มิเตอร์ก่อน (${trip.mileage.start} กม.)</div>
        <div class="attach-photo">${mbSrc?`<img src="${mbSrc}">`:'<span class="attach-empty">ไม่มีรูป</span>'}</div>
      </div>
      <div class="attach-photo-wrap">
        <div style="font-size:10pt;color:#555;margin-bottom:4pt">มิเตอร์หลัง (${trip.mileage.end} กม.)</div>
        <div class="attach-photo">${maSrc?`<img src="${maSrc}">`:'<span class="attach-empty">ไม่มีรูป</span>'}</div>
      </div>`;
      html += `<div style="margin-top:8pt;font-size:10pt;color:#2e7d32;font-weight:600">
        ระยะทาง ${km} กม. × ${MILE_RATE} บ./กม. = ${formatMoney(km*MILE_RATE)} บาท
      </div>`;
    } else {
      html += `<span class="attach-empty">ไม่มีค่าเดินทาง</span>`;
    }
    html += `</div></div>`;

    // Purchases
    if((trip.purchases||[]).length){
      html += `<div class="attach-sec"><div class="attach-sec-title">ส่วนที่ 3 — ค่าซื้อของ/เบิกของ</div>
        <table class="print-table"><thead><tr><th>รายละเอียด</th><th style="width:80pt;text-align:right">จำนวนเงิน</th></tr></thead><tbody>`;
      (trip.purchases||[]).forEach(p => {
        html += `<tr><td>${esc(p.desc)}</td><td style="text-align:right">${formatMoney(p.amount)}</td></tr>`;
      });
      html += `</tbody></table></div>`;
    }

    html += `</div>`;
  });

  return html;
}

export function doPrint(d){
  const html = buildPrintHTML(d);
  const styles = Array.from(document.styleSheets).map(ss => {
    try{ return Array.from(ss.cssRules).map(r=>r.cssText).join(' '); } catch(e){ return ''; }
  }).join(' ');
  const w = window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>ใบเบิกเงินสดย่อย ${esc(d.docNo||'')}</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${styles}</style></head><body>${html}</body></html>`);
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}
