function esc(s) {
  const t = String(s ?? '');
  // strip null/control, soft-hyphen, zero-width, BOM
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c <= 0x001f || c === 0x00ad || (c >= 0x200b && c <= 0x200f) || c === 0xfeff) continue;
    out += t[i];
  }
  return out.trim().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function splitVal(v) {
  const parts = String(v ?? '').split(/[\/\n\r]+/).map(s => s.trim());
  return [parts[0] || '', parts[1] || ''];
}

const STD_DIA = [
  { kv: 22, v95: 23.5, v240: 30.5, v400: 35.5, v500: 39 },
  { kv: 33, v95: 30,   v240: 35.5, v400: 40.5, v500: 44 },
];

const OB = '1.5px solid #444';
const IB = '1px solid #bbb';
const tdS = `border:${IB};padding:3pt 6pt;font-size:9pt;`;
const thS = `border:${IB};padding:4pt 6pt;background:#e8ecf3;font-size:8.5pt;font-weight:700;text-align:center;`;
const T   = 'width:100%;border-collapse:collapse;';

function buildHeader(fd) {
  const vol = fd.voltage || '33';
  const sz  = fd.cable_size || '';
  const cableSpec = sz
    ? `Underground Cable ${esc(vol)} kV XLPE 1 × ${esc(sz)} Sq.mm.`
    : `Underground Cable ${esc(vol)} kV XLPE`;
  return `
  <table class="tk-ft" style="${T}">
    <tr>
      <td rowspan="3" style="width:100pt;border-right:${IB};border-bottom:${OB};padding:16pt 8pt;
          background-image:url('img/pea-logo.jpg');background-size:contain;background-repeat:no-repeat;
          background-position:center center"></td>
      <td style="text-align:center;padding:1pt 6pt;border-bottom:${IB}">
        <strong style="font-size:11pt">Check sheet before installation termination kit</strong>
      </td>
    </tr>
    <tr>
      <td style="text-align:center;padding:1pt 6pt;border-bottom:${IB}">
        <strong style="font-size:12pt">22 - 33 kV Raychem</strong>
      </td>
    </tr>
    <tr>
      <td style="text-align:center;padding:1pt 6pt;border-bottom:${OB}">
        <strong style="font-size:10pt">${cableSpec}</strong>
      </td>
    </tr>
  </table>`;
}

const valS = `color:#1a56db;font-weight:600;max-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;

function buildProjectInfo(d, fd) {
  return `
  <table class="tk-ft" style="${T}table-layout:fixed">
    <colgroup><col style="width:100pt"><col></colgroup>
    <tr>
      <td style="${tdS}font-weight:700;border-bottom:${IB}">Project name</td>
      <td style="${tdS}${valS}border-bottom:${IB}">${esc(d.project_name || '')}</td>
    </tr>
    <tr>
      <td style="${tdS}font-weight:700;border-bottom:${IB}">Contract no.</td>
      <td style="${tdS}${valS}border-bottom:${IB}">${esc(d.contract_no || '')}</td>
    </tr>
    <tr>
      <td style="${tdS}font-weight:700;border-bottom:${OB}">Circuit designation</td>
      <td style="${tdS}${valS}border-bottom:${OB}">${esc(fd.circuit_designation || '')}${fd.install_position ? ` (${esc(fd.install_position)})` : ''}</td>
    </tr>
  </table>`;
}

function buildResponsibility(d, fd) {
  const installDate = fd.install_date
    ? new Date(fd.install_date).toLocaleDateString('th-TH', { year:'numeric', month:'2-digit', day:'2-digit' })
    : '';
  return `
  <table class="tk-ft" style="${T}font-size:9pt;border-top:${OB};table-layout:fixed">
    <colgroup>
      <col style="width:22%"><col style="width:26%"><col style="width:26%"><col style="width:26%">
    </colgroup>
    <tr>
      <th style="${thS}height:20pt;vertical-align:middle;border-top:${OB};border-bottom:${OB}">Responsibility</th>
      <th style="${thS}height:20pt;vertical-align:middle;border-top:${OB};border-bottom:${OB}">Installation by</th>
      <th style="${thS}height:20pt;vertical-align:middle;border-top:${OB};border-bottom:${OB}">Witness by</th>
      <th style="${thS}height:20pt;vertical-align:middle;border-top:${OB};border-bottom:${OB}">Witness by</th>
    </tr>
    <tr>
      <td style="${tdS}font-weight:700;text-align:center;height:20pt;border-bottom:${IB}">Company</td>
      <td style="${tdS}text-align:center;height:20pt;border-bottom:${IB};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.install_company || '')}</td>
      <td style="${tdS}text-align:center;height:20pt;border-bottom:${IB};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.witness1_company || '')}</td>
      <td style="${tdS}text-align:center;height:20pt;border-bottom:${IB};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.witness2_company || '')}</td>
    </tr>
    <tr>
      <td style="${tdS}font-weight:700;text-align:center;height:20pt;border-bottom:${IB}">Name - Surname</td>
      <td style="${tdS}text-align:center;height:20pt;border-bottom:${IB};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(fd.install_name || '')}</td>
      <td style="${tdS}text-align:center;height:20pt;border-bottom:${IB};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.witness1_name || '')}</td>
      <td style="${tdS}text-align:center;height:20pt;border-bottom:${IB};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.witness2_name || '')}</td>
    </tr>
    <tr>
      <td style="${tdS}font-weight:700;text-align:center;height:20pt;border-bottom:${IB}">Signature</td>
      <td style="${tdS}height:20pt;border-bottom:${IB};padding:1pt 4pt;overflow:hidden;text-align:center;vertical-align:middle">
        ${fd.install_signature
          ? `<img src="${esc(fd.install_signature)}" style="max-height:18pt;max-width:110pt;object-fit:contain;display:inline-block;vertical-align:middle">`
          : ''}
      </td>
      <td style="${tdS}height:20pt;border-bottom:${IB}"></td>
      <td style="${tdS}height:20pt;border-bottom:${IB}"></td>
    </tr>
    <tr>
      <td style="${tdS}font-weight:700;text-align:center;height:20pt;border-bottom:${OB}">D/M/Y</td>
      <td style="${tdS}text-align:center;height:20pt;border-bottom:${OB}">${esc(installDate)}</td>
      <td style="${tdS}text-align:center;height:20pt;border-bottom:${OB}">${esc(installDate)}</td>
      <td style="${tdS}text-align:center;height:20pt;border-bottom:${OB}">${esc(installDate)}</td>
    </tr>
  </table>`;
}

function buildCheckSheet(d, fd) {
  const m   = fd.measurements || {};
  const ph  = ['A','B','C'];

  function valTd(phase, key) {
    const val = m[phase]?.[key] || '';
    return `<td style="${tdS}text-align:center;font-weight:${val?'700':'400'};color:${val?'#1a56db':'#999'}">${esc(val)}</td>`;
  }

  const lCells = ph.map(p => valTd(p,'L')).join('');

  const kitModel = fd.kit_model || '';
  const kitBrand = fd.kit_brand || '';
  const kitType  = fd.kit_type  || '';
  const kitLabel = [kitBrand, kitType, kitModel].filter(Boolean).join(' — ');

  return `
<div style="font-family:'Sarabun','TH SarabunPSK',sans-serif;font-size:10pt;color:#000;width:100%;min-height:267mm;box-sizing:border-box;border:${OB};display:flex;flex-direction:column">
  ${buildHeader(fd)}
  ${buildProjectInfo(d, fd)}

  <div style="flex:1">
  <table class="tk-ft" style="${T}">
    <thead>
      <tr>
        <th style="${thS}width:28pt;border-bottom:${OB}" rowspan="2">ITEM</th>
        <th style="${thS}border-bottom:${OB}" rowspan="2">DESCRIPTION</th>
        <th style="${thS}border-bottom:${IB}" colspan="3">OPERATION LENGTH (MM)</th>
        <th style="${thS}border-bottom:${IB}" colspan="2">STANDARD LENGTH (MM)</th>
        <th style="${thS}border-bottom:${OB}" rowspan="2">PICTURE</th>
      </tr>
      <tr>
        <th style="${thS}width:44pt;border-bottom:${OB}">A</th>
        <th style="${thS}width:44pt;border-bottom:${OB}">B</th>
        <th style="${thS}width:44pt;border-bottom:${OB}">C</th>
        <th style="${thS}width:68pt;border-bottom:${OB}">22 kV</th>
        <th style="${thS}width:68pt;border-bottom:${OB}">33 kV</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="${tdS}text-align:center;vertical-align:middle">1</td>
        <td style="${tdS}">Remove oversheath length<br><span style="color:#666;font-size:8pt">ระยะเปิดเปลือกหุ้มสายเคเบิ้ล (L)</span></td>
        ${lCells}
        <td style="${tdS}text-align:center;font-style:italic;font-size:8pt;color:#333">indoor 280mm<br>outdoor 380mm</td>
        <td style="${tdS}text-align:center;font-style:italic;font-size:8pt;color:#333">indoor 380mm<br>outdoor 440mm</td>
        <td rowspan="5" style="${tdS}text-align:center;vertical-align:middle;padding:2pt">
          ${fd.detail_image_url
            ? `<img src="${esc(fd.detail_image_url)}" style="width:86pt;height:130pt;object-fit:contain;display:block;margin:0 auto">`
            : `<div style="border:1px dashed #ccc;width:86pt;height:130pt;display:flex;align-items:center;justify-content:center;font-size:7pt;color:#ccc;margin:0 auto">detail pic</div>`
          }
        </td>
      </tr>
      <tr>
        <td style="${tdS}text-align:center">2</td>
        <td style="${tdS}">Length of insulation screen<br><span style="color:#666;font-size:8pt">ระยะตัวกั้นฉนวน (S)</span></td>
        ${ph.map(p => valTd(p,'S')).join('')}
        <td style="${tdS}text-align:center;font-weight:700">40</td>
        <td style="${tdS}text-align:center;font-weight:700">40</td>
      </tr>
      <tr>
        <td style="${tdS}text-align:center">3</td>
        <td style="${tdS}">Diameter over insulation<br><span style="color:#666;font-size:8pt">ขนาดเส้นผ่านศูนย์กลางฉนวน</span></td>
        ${ph.map(p => valTd(p,'dia')).join('')}
        <td style="${tdS}text-align:center;font-style:italic;font-size:8pt" colspan="2">Note 1</td>
      </tr>
      <tr>
        <td style="${tdS}text-align:center">4</td>
        <td style="${tdS}">Length of conductor<br><span style="color:#666;font-size:8pt">ระยะตัวนำ (K)</span></td>
        ${ph.map(p => valTd(p,'K')).join('')}
        <td style="${tdS}text-align:center;font-style:italic;font-size:8pt" colspan="2">Depth of connector barrel<br>+ 5 mm</td>
      </tr>
      <tr>
        <td style="${tdS}text-align:center">5</td>
        <td style="${tdS}">Termination kit model<br><span style="color:#666;font-size:8pt">รุ่น Termination kit</span></td>
        <td style="${tdS}text-align:center;font-weight:700;color:#1a56db" colspan="5">${esc(kitLabel)}</td>
      </tr>
    </tbody>
  </table>

  <div style="padding:4pt 6pt;font-size:8pt;border-top:${IB}">
    <strong>Remark</strong> <span style="color:#c00">ระยะตัวนำ (K)</span> : Do not use cable lugs with barrel holes deeper than max. 110 mm.
  </div>

  <div style="padding:4pt 6pt;font-size:8pt;display:inline-block;margin-top:6pt">
    <div style="font-style:italic;margin-bottom:4pt">*Note1 Standard Diameter over Crosslinked polyethylene (mm)</div>
    <table style="border-collapse:collapse;font-size:8pt">
      <tr>
        <th style="${thS}text-align:left;font-size:8pt">ระดับแรงดันใช้งาน (kV)</th>
        <th style="${thS}font-size:8pt">95 mm²</th>
        <th style="${thS}font-size:8pt">240 mm²</th>
        <th style="${thS}font-size:8pt">400 mm²</th>
        <th style="${thS}font-size:8pt">500 mm²</th>
      </tr>
      ${STD_DIA.map(r => `
      <tr>
        <td style="${tdS}text-align:center">${r.kv}</td>
        <td style="${tdS}text-align:center">${r.v95}</td>
        <td style="${tdS}text-align:center">${r.v240}</td>
        <td style="${tdS}text-align:center">${r.v400}</td>
        <td style="${tdS}text-align:center">${r.v500}</td>
      </tr>`).join('')}
    </table>
  </div>
  </div>

  ${buildResponsibility(d, fd)}
</div>`;
}

function buildPhotoPage(d, fd, phase, breakBefore = false) {
  const m      = fd.measurements || {};
  const photos = (m[phase] || {}).photos || {};

  const ITEMS = [
    { key: 'L',   label: 'Item 1 : Remove oversheath length (L)' },
    { key: 'S',   label: 'Item 2 : Length of insulation screen (S)' },
    { key: 'dia', label: 'Item 3 : Diameter over insulation' },
    { key: 'K',   label: 'Item 4 : Length of conductor (K)' },
  ];

  function photoCell(key, label) {
    const url = photos[key];
    const inner = url
      ? `<img src="${esc(url)}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;background:#fff" />`
      : `<div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:8pt">ไม่มีรูป</div>`;
    return `
    <div style="display:flex;flex-direction:column;gap:4pt;flex:1;min-height:0">
      <div style="flex:1;overflow:hidden;border:${IB};position:relative">${inner}</div>
      <div style="font-size:7.5pt;text-align:center;color:#555">${esc(label)}</div>
    </div>`;
  }

  const pb2 = breakBefore ? 'page-break-before:always;' : '';
  return `
<div style="${pb2}font-family:'Sarabun','TH SarabunPSK',sans-serif;font-size:10pt;color:#000;width:100%;min-height:267mm;box-sizing:border-box;border:${OB};display:flex;flex-direction:column">
  ${buildHeader(fd)}
  ${buildProjectInfo(d, fd)}

  <div style="padding:5pt 8pt;font-weight:700;font-size:11pt;background:#f0f4ff;border-bottom:${OB};border-top:${IB}">
    Phase ${esc(phase)}
  </div>

  <div style="flex:1;padding:8pt;display:flex;flex-direction:column;gap:8pt;min-height:0">
    <div style="flex:1;display:flex;gap:8pt;min-height:0">
      ${photoCell(ITEMS[0].key, ITEMS[0].label)}
      ${photoCell(ITEMS[1].key, ITEMS[1].label)}
    </div>
    <div style="flex:1;display:flex;gap:8pt;min-height:0">
      ${photoCell(ITEMS[2].key, ITEMS[2].label)}
      ${photoCell(ITEMS[3].key, ITEMS[3].label)}
    </div>
  </div>

  ${buildResponsibility(d, fd)}
</div>`;
}

export function buildTerminationPrintHTML(d) {
  const feeders = d.feeders?.length > 0 ? d.feeders : [{}];
  const allPages = [];

  feeders.forEach((fd, fi) => {
    allPages.push({ html: buildCheckSheet(d, fd), label: `วงจร ${fi + 1} — Check Sheet` });
    ['A','B','C'].forEach(phase => {
      const photos = fd.measurements?.[phase]?.photos || {};
      const hasPhoto = Object.values(photos).some(Boolean);
      if (hasPhoto) {
        allPages.push({ html: buildPhotoPage(d, fd, phase, true), label: `วงจร ${fi + 1} — Phase ${phase}` });
      }
    });
  });

  return allPages.map((p, i) => `
    <div class="tk-page-sep" style="margin:16px 0;padding:4px 8px;background:#e2e8f0;font-size:11px;color:#64748b;border-radius:4px">
      หน้า ${i + 1}: ${p.label}
    </div>
    ${p.html}
  `).join('');
}

const printCSS = `
@page {
  size: A4 portrait;
  margin: 12mm 15mm 18mm 15mm;
  @bottom-center {
    content: "Page " counter(page) " of " counter(pages);
    font-size: 8pt;
    color: #666;
    font-family: 'Sarabun', sans-serif;
  }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 0; background: #fff; font-family: 'Sarabun','TH SarabunPSK',sans-serif; }
.tk-ft td:first-child, .tk-ft th:first-child { border-left: none !important; }
.tk-ft td:last-child,  .tk-ft th:last-child  { border-right: none !important; }
img { max-width: 100%; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .tk-page-sep { display: none !important; }
}
`;

export function doTerminationPrint(d) {
  const content = buildTerminationPrintHTML(d);
  let iframe = document.getElementById('_tk-print-frame');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = '_tk-print-frame';
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none';
    document.body.appendChild(iframe);
  }
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Termination Kit</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${printCSS}</style>
    </head><body>${content}</body></html>`);
  doc.close();
  iframe.onload = () => { iframe.contentWindow.focus(); iframe.contentWindow.print(); };
}
