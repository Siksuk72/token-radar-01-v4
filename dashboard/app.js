"use strict";
const R = window.RADAR; const rows = R.rows;
const $ = id => document.getElementById(id);
const fmtM = n => n >= 1e9 ? '$' + (n/1e9).toFixed(2)+'B' : n >= 1e6 ? '$'+(n/1e6).toFixed(1)+'M' : '$'+Math.round(n);
// stats
$('stats').innerHTML =
  `<span><b>${R.stats.total}</b> protocol pre-token</span><span><b>${R.stats.watchlist}</b> watchlist (TVL ≥ $50M)</span>`+
  `<span><b style="color:var(--farm)">${R.stats.farm}</b> FARM</span><span><b style="color:var(--thin)">${R.stats.thin}</b> THIN</span><span><b>${R.stats.skip}</b> SKIP</span>`;
// filter options
const cats = [...new Set(rows.map(r=>r.category))].sort();
const chs = [...new Set(rows.flatMap(r=>r.chains))].sort();
$('cat').innerHTML += cats.map(c=>`<option>${c}</option>`).join('');
$('chain').innerHTML += chs.map(c=>`<option>${c}</option>`).join('');
// state
let verdict="ALL", sortKey="rank", sortDir=1, openRow=null;
document.querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('on'));ch.classList.add('on');verdict=ch.dataset.v;render()});
$('q').oninput = render; $('cat').onchange = render; $('chain').onchange = render;
document.querySelectorAll('th[data-s]').forEach(th=>th.onclick=()=>{const k=th.dataset.s;sortDir=(sortKey===k?-sortDir:1);sortKey=k;render()});
function filtered(){
  const q=$('q').value.toLowerCase(), cat=$('cat').value, ch=$('chain').value;
  return rows.filter(r=>
    (verdict==="ALL"||r.verdict===verdict) && (!cat||r.category===cat) && (!ch||r.chains.includes(ch)) &&
    (!q||r.name.toLowerCase().includes(q)||r.category.toLowerCase().includes(q)||r.chains.join(' ').toLowerCase().includes(q)))
  .sort((a,b)=>{const x=a[sortKey],y=b[sortKey];return (typeof x==="string"?x.localeCompare(y):x-y)*sortDir});
}
function render(){
  const f=filtered();
  $('count').textContent = f.length + " baris";
  $('tb').innerHTML = f.map(r=>`<tr class="r" onclick="openDetail(${r.rank})">
    <td>${r.rank}</td><td><b>${r.name}</b> ${r.symbol?`<span class="c">(${r.symbol})</span>`:""} ${r.watchlist?'<span class="bdg" style="background:#3b2c17;color:#ffd24d">WATCHLIST</span>':''}</td>
    <td>${r.category}</td><td>${r.chains.slice(0,3).map(c=>`<span class="bdg">${c}</span>`).join('')}${r.chains.length>3?'<span class="c">+'+(r.chains.length-3)+'</span>':''}</td>
    <td>${fmtM(r.tvl)}</td><td class="c">${r.change7d==null?'—':(r.change7d>0?'+':'')+(r.change7d*100).toFixed(1)+'%'}</td>
    <td class="imp">${fmtM(r.implied)}</td><td><span class="conf ${r.confidence}">${r.confidence[0]}</span></td>
    <td><span class="v ${r.verdict}">${r.verdict}</span></td></tr>`).join('');
}
function openDetail(rank){
  const r=rows.find(x=>x.rank===rank); openRow=rank;
  $('dBody').innerHTML=`
    <h2>${r.name}</h2><div class="c">${r.category} · ${r.chains.join(', ')||'—'} · TVL ${fmtM(r.tvl)}</div>
    <div class="kv">
      <b>Implied value</b><span class="imp" style="font-size:20px">${fmtM(r.implied)}</span>
      <b>Verdict</b><span class="v ${r.verdict}">${r.verdict}</span>
      <b>Confidence</b><span class="conf ${r.confidence}">${r.confidence}</span>
    </div>
    <div style="margin:10px 0 4px" class="c">— dari mana angkanya (model radar-v1) —</div>
    <div class="factor"><span>TVL</span><b>${fmtM(r.tvl)}</b></div>
    <div class="factor"><span>× multiple kategori (size-adjusted)</span><b>${r.multiple}</b></div>
    <div class="factor"><span>× growth 7 hari</span><b>${r.growth}</b></div>
    <div class="factor"><span>× maturity (usia tanpa token)</span><b>${r.maturity}</b></div>
    <div class="factor"><span>× breadth (jumlah chain)</span><b>${r.breadth}</b></div>
    <div style="margin:14px 0 4px" class="c">— risiko yang diakui —</div>
    ${r.risks.map(x=>`<div class="risk">⚠ ${x}</div>`).join('') || '<div class="c">tidak ada risiko data yang menonjol</div>'}
    <div style="margin:14px 0 4px" class="c">— langkah farming (7) —</div>
    <ol class="plan">${r.plan.map(p=>`<li>${p.replace(/^\d+\.\s*/,'')}</li>`).join('')}</ol>`;
  $('detail').style.display='block';
}
function closeDetail(){$('detail').style.display='none'}
render();

// dukungan deep-link untuk screenshot/berbagi: ?verdict=FARM&cat=X&chain=Y&q=z&detail=5
const params = new URLSearchParams(location.search);
if (params.get('verdict')) {
  const v = params.get('verdict');
  document.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x.dataset.v === v));
  verdict = v;
}
if (params.get('cat')) $('cat').value = params.get('cat');
if (params.get('chain')) $('chain').value = params.get('chain');
if (params.get('q')) $('q').value = params.get('q');
render();
if (params.get('detail')) openDetail(+params.get('detail'));
