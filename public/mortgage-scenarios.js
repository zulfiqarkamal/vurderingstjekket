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
    return {key,label,rate,payment,delta,fee,eligibleForNewLoan:true,breakEven: delta < 0 && d.ltype !== 'afdragsfri' ? Math.ceil(fee/-delta) : null};
  });
  const levels = [0,10,20,30,40,50,55,60,65,70,75,80];
  const upTerm = blrBorrowYears(d.upTerm,d.loeb);
  function at(pct,years=d.loeb) {
    const debt = value*pct/100;
    const gross = debt-d.rest;
    const cost = debt === 0 ? 0 : konvOmk(Math.max(debt,d.rest));
    const rawPayment=mYdelse(debt,d.rente,years,bidragssats(pct),false);
    const payment = Math.round(rawPayment);
    return {pct,debt,gross,fee:cost,cash:gross-cost,payment,delta:payment-baseline,bidrag:bidragssats(pct),years,totalFinancing:Math.round(Math.max(0,rawPayment*years*12-debt))};
  }
  const current = d.rest/value*100;
  return {baseline,value,lower,upTerm,best:lower.filter(row=>row.eligibleForNewLoan).reduce((a,b)=>a.payment<=b.payment?a:b),
    up:levels.filter(p=>p>current+0.000001 && (p-current>=0.1 || bidragssats(p)!==bidragssats(current))).map(p=>at(p,upTerm)),
    down:levels.filter(p=>p<current-0.000001 && (current-p>=0.1 || bidragssats(p)!==bidragssats(current))).reverse().slice(0,5).map(p=>at(p))};
}
function blrMoney(v, signed=false) {
  const n = Math.round(v);
  return (signed && n>0?'+':n<0?'−':'')+Math.abs(n).toLocaleString('da-DK')+' kr';
}
function blrPropertyAmount(value) {
  return 'ca. '+(Number(value)/1000000).toLocaleString('da-DK',{minimumFractionDigits:1,maximumFractionDigits:1})+' mio. kr';
}
function blrDelta(v) { return `<span class="${v<0?'blr-sc-pos':v>0?'blr-sc-neg':''}">${blrMoney(v,true)}/md</span>`; }
function blrTable(headers,rows) {
  return `<table class="blr-scenario-table blr-responsive"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((cell,i)=>`<td data-label="${headers[i]}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function blrScenarioCosts(rows,up=false) {
    const fees=rows.map(e=>Math.round(e.fee));const min=Math.min(...fees),max=Math.max(...fees);
    const amount=min===max?blrMoney(min):`${blrMoney(min)}–${blrMoney(max)}`;
    return `<p class="blr-cost-note">Anslåede omkostninger: <strong>${amount}</strong>${up?' afhængigt af lånebeløb; allerede trukket fra udbetalingen.':'; betales én gang og er med i den viste indbetaling.'}</p>`;
  }
function blrLTVRows(rows,up) {
    if(!rows.length) return `<p class="blr-empty">${up?'Der er ikke plads til yderligere realkreditbelåning inden for 80% i dette estimat.':'Ingen lavere belåningsgrader at vise.'}</p>`;
    return blrTable(['Belåning (LTV)',up?'Ekstra gæld':'Afdrag på gæld',up?'Udbetalt efter omk.':'Indbetaling inkl. omk.','Ny restgæld','Samlet ydelse/md.','Ændring/md.'],rows.map(e=>[e.pct+'%',blrMoney(Math.abs(e.gross)),blrMoney(e.cash,true),blrMoney(e.debt),blrMoney(e.payment)+'/md',blrDelta(e.delta)]))+blrScenarioCosts(rows,up);
  }

function blrBorrowYears(value,current) {
  const fallback=Math.min(30,Math.max(1,Number(current)||30));
  const number=(typeof value==='string'||typeof value==='number')&&value!==''?Number(value):NaN;
  return Number.isFinite(number)&&number>=1&&number<=30?number:fallback;
}
function blrBorrowPanel(d,m=blrScenarioModel(d)) {
  const options=[...new Set([blrBorrowYears(null,d.loeb),10,15,20,25,30])].sort((a,b)=>a-b);
  const selector=`<label for="blrBorrowYears" style="display:block;font-weight:600">Løbetid på hele det nye lån</label><select id="blrBorrowYears" style="max-width:100%;padding:8px;margin:6px 0 12px" onchange="blrSetBorrowTerm(this.value)">${options.map(years=>`<option value="${years}"${years===m.upTerm?' selected':''}>${years} år${years===Number(d.loeb)?' (nuværende restløbetid)':''}</option>`).join('')}</select>`;
  const basis=`<p class="blr-payment-basis"><strong>Hele den nye restgæld med afdrag over ${m.upTerm} år.</strong> Ændringen sammenlignes med din nuværende betaling på ${blrMoney(m.baseline)}/md${d.ltype==='afdragsfri'?' uden afdrag':''}. En længere løbetid kan sænke ydelsen og samtidig øge de samlede rente- og bidragsbetalinger. Lavere ydelse er ikke nødvendigvis en besparelse.</p>`;
  const totals=m.up.length?`<details class="blr-help"><summary>Samlet modelrente og bidrag over ${m.upTerm} år</summary>${blrTable(['Belåning (LTV)','Rente og bidrag i alt'],m.up.map(row=>[row.pct+'%',blrMoney(row.totalFinancing)]))}<p>Hele den nye gæld afvikles over ${m.upTerm} år ved uændret rente og modelbidrag. Beløbene er før skat og uden engangsomkostninger. Bidraget modelleres sammen med renten; faktiske satser og betalinger kan ændre sig.</p></details>`:'';
  return selector+basis+`<p class="blr-cost-note">Beregnet med din oplyste rente på ${Number(d.rente).toLocaleString('da-DK',{maximumFractionDigits:3})}% og anslået bidrag. Et nyt lån kan have en anden rente.</p>`+'<details class="blr-help"><summary>ⓘ Lån op — sådan læses tallene</summary><p>Se ekstra gæld, udbetaling efter omkostninger og ydelsen på hele den nye gæld. Långivers vurdering og kreditgodkendelse er nødvendig.</p></details>'+blrLTVRows(m.up,true)+totals;
}
function blrSetBorrowTerm(value) {
  const d=window._blrBorrowState||window._beregningState;
  if(!d)return;
  const years=blrBorrowYears(value,d.loeb);
  if(![blrBorrowYears(null,d.loeb),10,15,20,25,30].includes(years))return;
  const panel=document.getElementById('blr-panel-up');
  if(!panel)return;
  window._blrBorrowTerm=years;
  panel.innerHTML=blrBorrowPanel(d,blrScenarioModel({...d,upTerm:years}));
  document.getElementById('blrBorrowYears')?.focus();
}
function blrScenarioMarkup(d) {
  if(typeof window!=='undefined'){
    if(window._blrBorrowState!==d){window._blrBorrowState=d;window._blrBorrowTerm=blrBorrowYears(null,d.loeb);}
  }
  const m=blrScenarioModel({...d,upTerm:typeof window!=='undefined'?window._blrBorrowTerm:d.upTerm});
  const help={lower:'Sammenlign F1, F3, F5 og fast rente med afdrag. Ikke alle banker tilbyder alle lånetyper. Dette er modelscenarier med indikative renter og anslået bidrag, ikke en rangering af bankernes tilbud. Se ny samlet ydelse og ændringen fra din nuværende betaling.',up:'Se ekstra gæld, beløbet du får udbetalt efter anslåede omkostninger og din nye samlede ydelse. Kræver långivers vurdering og kreditgodkendelse.',down:'Se engangsindbetalingen inklusive anslåede omkostninger, ny restgæld og samlet ydelse ved lavere belåningsgrad.'};
  const tabs=[['lower','Lavere ydelse'],['up','Lån op'],['down','Betal ned']];
  const hold=[`Behold nuværende ${['Nordea','Nykredit','Totalkredit','Realkredit Danmark','Jyske'].includes(d.institution)?blrEscape(d.institution)+'-lån':'lån'} (${d.ltype==='afdragsfri'?'uden afdrag':'med afdrag'})`,d.rente.toFixed(2)+'%',blrMoney(m.baseline)+'/md','0 kr/md'];
  const lowerRows=m.lower.map(e=>[e.label,e.rate.toFixed(2)+'%',blrMoney(e.payment)+'/md',blrDelta(e.delta)]);
  const extras=(d.extScener||[]).filter(e=>['afdragsfri','afdrag'].includes(e.key));
  const extraHtml=extras.length?`<details><summary>Afdrag og afdragsfrihed</summary>${blrTable(['Alternativ','Samlet ydelse','Ændring/md.'],extras.map(e=>[e.label,blrMoney(e.ydelse)+'/md',blrDelta(e.ydelse-m.baseline)]))}<p>Afdragsfrihed sænker betalingen, men restgælden afdrages ikke. Skift til afdrag øger betalingen og nedbringer gælden. Lavere ydelse er ikke nødvendigvis en økonomisk besparelse.</p></details>`:'';
  const basis=`<p class="blr-payment-basis"><strong>Nye scenarier: med afdrag over ${d.loeb} år.</strong> ${d.ltype==='afdragsfri'?`Din nuværende betaling på ${blrMoney(m.baseline)}/md er <strong>uden afdrag</strong>. Grønne/røde ændringer sammenligner med denne betaling. En højere ydelse omfatter også afdrag, som reducerer din gæld — ikke kun en ekstra udgift.`:'Grønne/røde ændringer sammenligner med din nuværende betaling med afdrag.'}</p>`;
  return `<div class="blr-scenario-title">Omlægningsscenarier</div><p class="blr-scenario-intro">Hvad vil du undersøge? Nuværende betaling: <strong>${blrMoney(m.baseline)}/md</strong></p>
    <p class="blr-cost-note">Vejledende beregninger med referencerenter og anslået bidrag — ikke personlige lånetilbud. Ændring/md. er en beregnet betalingsforskel.</p>
    <div class="blr-scenario-tabs" role="tablist" aria-label="Vælg scenarie">${tabs.map(([key,label],i)=>`<button type="button" role="tab" id="blr-tab-${key}" aria-controls="blr-panel-${key}" aria-selected="${i===0}" tabindex="${i===0?0:-1}" title="${help[key]}" onclick="blrSelectScenario('${key}')" onkeydown="blrScenarioKey(event,${i})">${label}</button>`).join('')}</div>
    ${tabs.map(([key,label],i)=>`<section role="tabpanel" id="blr-panel-${key}" aria-labelledby="blr-tab-${key}" ${i?'hidden':''}>${key==='up'?blrBorrowPanel(d,m):basis+`<details class="blr-help"><summary>ⓘ ${label} — sådan læses tallene</summary><p>${help[key]}</p></details>`}${key==='lower'?blrTable(['Lånetype','Rente','Samlet ydelse/md.','Ændring/md.'],[...lowerRows,hold])+`<p class="blr-help">Ikke alle banker tilbyder alle lånetyper. Renter og bidrag er modelestimater, ikke personlige tilbud; en kildereference er ikke et tilbud fra den bank, der tilbyder produktet.</p><p class="blr-cost-note">Anslåede omkostninger ved omlægning: <strong>${blrMoney(m.lower[0].fee)}</strong> én gang. Beholder du lånet, er der ingen omlægningsomkostning.</p>`+extraHtml:key==='up'?'':blrLTVRows(m.down,false)}</section>`).join('')}
    <details class="blr-help"><summary>Forudsætninger og omkostninger</summary><p>Alle ydelser er før skat og inkluderer modellens anslåede bidrag. Minus ved månedlig ændring betyder lavere betaling; plus betyder højere betaling. Kontantbeløb: plus er penge til dig, minus er penge du skal betale.</p><p>Omkostninger anslås med den eksisterende model (15.000 kr + 0,5% af beregningsgælden). Ved omlægning og nedbetaling betales de kontant; ved lån op trækkes de fra udbetalingen. De finansieres ikke i den viste gæld. Ved fuld indfrielse vises 0 kr i modelgebyr; indfrielsesgebyrer kan forekomme.</p><p>Lån op bruger din nuværende rente og den valgte løbetid på hele den nye gæld, med afdrag. Betal ned bruger din nuværende rente og resterende løbetid. Lavere ydelse viser markedsestimater med afdrag over samme løbetid. Afdragsfrie alternativer er særskilt mærket under Afdrag og afdragsfrihed. Variabel rente kan ændre ydelsen.</p><p>Kurser, indfrielsesvilkår og faktiske gebyrer er ikke kendt og er ikke med i disse scenarier. Kontakt din långiver for et bindende tilbud og kreditgodkendelse.</p></details>`;
}
function blrEscape(value) {return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function blrPropertySource(d) {
  const p=d.property||window._mortgageProperty||{};
  if(p.kilde==='boligsiden-udbud')return `Boligsiden · ${p.aktiveAnnoncer||0} sammenlignelige udbud · udbudspriser`;
  if(p.kilde==='boligsiden-omraade-udbud')return `Boligsiden · ${p.aktiveAnnoncer||0} lokale udbud · m²-estimat`;
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
  if(target==='dok'){document.getElementById('phase2-header').style.display='block';document.querySelector('.stepper').style.display='none';goToPhase2(6);return;}
  document.querySelectorAll('.blr-subnav-tab').forEach(t=>t.classList.toggle('active',t===el));
  const sel={top:'.blr-page',scenarier:'.blr-scenario-card',rente:'.blr-chart-card',ltv:'.ltv-sektion'}[target];
  const section=document.querySelector(sel);
  if(section){const details=section.closest('details');if(details)details.open=true;section.scrollIntoView({behavior:'smooth',block:'start'});}
}
