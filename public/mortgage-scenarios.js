/* Uses the existing mortgage engine; amounts are estimates before tax. */
function blrScenarioModel(d) {
  const value = d.markedsEjd || d.ejd;
  const baseline = Math.round(d.nuv);
  const fee = konvOmk(d.rest);
  const types = [['F1','F1 Flekslån'],['F3','F3 Flekslån'],['F5','F5 Flekslån'],['fastforrentet','Fast rente']];
  const lower = types.map(([key,label]) => {
    const rate = d.renter[key] ?? d.renter.fastforrentet;
    const payment = Math.round(mYdelse(d.rest, rate, d.loeb, bidragssats(d.rest/value*100)));
    const delta = payment-baseline;
    return {key,label,rate,payment,delta,fee,breakEven: delta < 0 && d.ltype !== 'afdragsfri' ? Math.ceil(fee/-delta) : null};
  });
  const levels = [0,10,20,30,40,50,55,60,65,70,75,80];
  function at(pct) {
    const debt = value*pct/100;
    const gross = debt-d.rest;
    const cost = debt === 0 ? 0 : konvOmk(Math.max(debt,d.rest));
    const payment = Math.round(mYdelse(debt,d.rente,d.loeb,bidragssats(pct),false));
    return {pct,debt,gross,fee:cost,cash:gross-cost,payment,delta:payment-baseline,bidrag:bidragssats(pct)};
  }
  const current = d.rest/value*100;
  return {baseline,value,lower,best:lower.reduce((a,b)=>a.payment<=b.payment?a:b),
    up:levels.filter(p=>p>current+0.000001 && (p-current>=0.1 || bidragssats(p)!==bidragssats(current))).map(at),
    down:levels.filter(p=>p<current-0.000001 && (current-p>=0.1 || bidragssats(p)!==bidragssats(current))).reverse().slice(0,5).map(at)};
}
function blrMoney(v, signed=false) {
  const n = Math.round(v);
  return (signed && n>0?'+':n<0?'−':'')+Math.abs(n).toLocaleString('da-DK')+' kr';
}
function blrDelta(v) { return `<span class="${v<0?'blr-sc-pos':v>0?'blr-sc-neg':''}">${blrMoney(v,true)}/md</span>`; }
function blrTable(headers,rows) {
  return `<table class="blr-scenario-table blr-responsive"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((cell,i)=>`<td data-label="${headers[i]}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function blrScenarioMarkup(d) {
  const m=blrScenarioModel(d);
  const help={lower:'Sammenlign F1, F3, F5 og fast rente med afdrag. Se ny samlet ydelse og ændringen fra din nuværende betaling.',up:'Se ekstra gæld, beløbet du får udbetalt efter anslåede omkostninger og din nye samlede ydelse. Kræver långivers vurdering og kreditgodkendelse.',down:'Se engangsindbetalingen inklusive anslåede omkostninger, ny restgæld og samlet ydelse ved lavere belåningsgrad.'};
  const tabs=[['lower','Lavere ydelse'],['up','Lån op'],['down','Betal ned']];
  const hold=[`Behold nuværende lån (${d.ltype==='afdragsfri'?'uden afdrag':'med afdrag'})`,d.rente.toFixed(2)+'%',blrMoney(m.baseline)+'/md','0 kr/md'];
  const lowerRows=m.lower.map(e=>[e.label,e.rate.toFixed(2)+'%',blrMoney(e.payment)+'/md',blrDelta(e.delta)]);
  const extras=(d.extScener||[]).filter(e=>['afdragsfri','afdrag'].includes(e.key));
  const extraHtml=extras.length?`<details><summary>Afdrag og afdragsfrihed</summary>${blrTable(['Alternativ','Samlet ydelse','Ændring/md.'],extras.map(e=>[e.label,blrMoney(e.ydelse)+'/md',blrDelta(e.ydelse-m.baseline)]))}<p>Afdragsfrihed sænker betalingen, men restgælden afdrages ikke. Skift til afdrag øger betalingen og nedbringer gælden. Lavere ydelse er ikke nødvendigvis en økonomisk besparelse.</p></details>`:'';
  const basis=`<p class="blr-payment-basis"><strong>Nye scenarier: med afdrag over ${d.loeb} år.</strong> ${d.ltype==='afdragsfri'?`Din nuværende betaling på ${blrMoney(m.baseline)}/md er <strong>uden afdrag</strong>. Grønne/røde ændringer sammenligner med denne betaling. En højere ydelse omfatter også afdrag, som reducerer din gæld — ikke kun en ekstra udgift.`:'Grønne/røde ændringer sammenligner med din nuværende betaling med afdrag.'}</p>`;
  function costNote(rows,up=false) {
    const fees=rows.map(e=>Math.round(e.fee));const min=Math.min(...fees),max=Math.max(...fees);
    const amount=min===max?blrMoney(min):`${blrMoney(min)}–${blrMoney(max)}`;
    return `<p class="blr-cost-note">Anslåede omkostninger: <strong>${amount}</strong>${up?' afhængigt af lånebeløb; allerede trukket fra udbetalingen.':'; betales én gang og er med i den viste indbetaling.'}</p>`;
  }
  function ltvRows(rows,up) {
    if(!rows.length) return `<p class="blr-empty">${up?'Der er ikke plads til yderligere realkreditbelåning inden for 80% i dette estimat.':'Ingen lavere belåningsgrader at vise.'}</p>`;
    return blrTable(['Belåning (LTV)',up?'Ekstra gæld':'Afdrag på gæld',up?'Udbetalt efter omk.':'Indbetaling inkl. omk.','Ny restgæld','Samlet ydelse/md.','Ændring/md.'],rows.map(e=>[e.pct+'%',blrMoney(Math.abs(e.gross)),blrMoney(e.cash,true),blrMoney(e.debt),blrMoney(e.payment)+'/md',blrDelta(e.delta)]))+costNote(rows,up);
  }
  return `<div class="blr-scenario-title">Omlægningsscenarier</div><p class="blr-scenario-intro">Hvad vil du undersøge? Nuværende betaling: <strong>${blrMoney(m.baseline)}/md</strong></p>
    <div class="blr-scenario-tabs" role="tablist" aria-label="Vælg scenarie">${tabs.map(([key,label],i)=>`<button type="button" role="tab" id="blr-tab-${key}" aria-controls="blr-panel-${key}" aria-selected="${i===0}" tabindex="${i===0?0:-1}" title="${help[key]}" onclick="blrSelectScenario('${key}')" onkeydown="blrScenarioKey(event,${i})">${label}</button>`).join('')}</div>
    ${tabs.map(([key,label],i)=>`<section role="tabpanel" id="blr-panel-${key}" aria-labelledby="blr-tab-${key}" ${i?'hidden':''}>${basis}<details class="blr-help"><summary>ⓘ ${label} — sådan læses tallene</summary><p>${help[key]}</p></details>${key==='lower'?blrTable(['Lånetype','Rente','Samlet ydelse/md.','Ændring/md.'],[...lowerRows,hold])+`<p class="blr-cost-note">Anslåede omkostninger ved omlægning: <strong>${blrMoney(m.lower[0].fee)}</strong> én gang. Beholder du lånet, er der ingen omlægningsomkostning.</p>`+extraHtml:ltvRows(key==='up'?m.up:m.down,key==='up')}</section>`).join('')}
    <details class="blr-help"><summary>Forudsætninger og omkostninger</summary><p>Alle ydelser er før skat og inkluderer modellens anslåede bidrag. Minus ved månedlig ændring betyder lavere betaling; plus betyder højere betaling. Kontantbeløb: plus er penge til dig, minus er penge du skal betale.</p><p>Omkostninger anslås med den eksisterende model (15.000 kr + 0,5% af beregningsgælden). Ved omlægning og nedbetaling betales de kontant; ved lån op trækkes de fra udbetalingen. De finansieres ikke i den viste gæld. Ved fuld indfrielse vises 0 kr i modelgebyr; indfrielsesgebyrer kan forekomme.</p><p>Lån op/ned bruger din nuværende rente og resterende løbetid på hele gælden, med afdrag. Lavere ydelse viser markedsestimater med afdrag over samme løbetid. Afdragsfrie alternativer er særskilt mærket under Afdrag og afdragsfrihed. Variabel rente kan ændre ydelsen.</p><p>Kurser, indfrielsesvilkår og faktiske gebyrer er ikke kendt og er ikke med i disse scenarier. Kontakt din långiver for et bindende tilbud og kreditgodkendelse.</p></details>`;
}
function blrEscape(value) {return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function blrPropertySource(d) {
  const p=d.property||window._mortgageProperty||{};
  if(p.kilde==='boliga-udbud')return `${p.aktiveAnnoncer||0} sammenlignelige udbud · udbudspriser`;
  if(p.kilde==='boliga')return `${p.compsCount||0} sammenlignelige salg · seneste 12 måneder`;
  if(p.kilde==='boliga-omraade')return `${p.compsCount||0} lokale salg · m²-estimat · seneste 12 måneder`;
  if(p.kilde==='boliga-omraade-udbud')return `${p.aktiveAnnoncer||0} lokale udbud · områdebaseret m²-estimat`;
  if(p.kilde==='ev')return 'EV-reserve · Skats vurdering — handelsprisen kan være højere';
  return d.markedsEjd?'Markedsestimat':'Markedsværdi mangler';
}
function blrSelectScenario(key,focus=false) {
  ['lower','up','down'].forEach(k=>{
    const tab=document.getElementById('blr-tab-'+k);
    tab.setAttribute('aria-selected',String(k===key));tab.tabIndex=k===key?0:-1;
    document.getElementById('blr-panel-'+k).hidden=k!==key;
    if(focus && k===key) tab.focus();
  });
}
function blrScenarioKey(event,index) {
  const keys=['lower','up','down'];let target;
  if(event.key==='ArrowRight') target=(index+1)%3;
  if(event.key==='ArrowLeft') target=(index+2)%3;
  if(event.key==='Home') target=0;
  if(event.key==='End') target=2;
  if(target!==undefined){event.preventDefault();blrSelectScenario(keys[target],true);}
}
function blrNavTo(el,target) {
  if(target==='dok'){alert('Dokumenter kommer senere. Bankpakken findes under Lån & vilkår.');return;}
  document.querySelectorAll('.blr-subnav-tab').forEach(t=>t.classList.toggle('active',t===el));
  const sel={top:'.blr-page',scenarier:'.blr-scenario-card',rente:'.blr-chart-card',ltv:'.ltv-sektion'}[target];
  const section=document.querySelector(sel);
  if(section){if(section.tagName==='DETAILS')section.open=true;section.scrollIntoView({behavior:'smooth',block:'start'});}
}
