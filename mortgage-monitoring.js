const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const contribution = ltv => ltv <= 40 ? .40 : ltv <= 60 ? .55 : ltv <= 80 ? .85 : 1.50;
function payment(debt, rate, years, bidrag) {
  const monthly=(rate+bidrag)/1200, months=years*12;
  return monthly===0 ? debt/months : debt*monthly/(1-Math.pow(1+monthly,-months));
}
function sourceLabel(market) {
  if(market?.kilde==='ev')return 'EV-reserve · Skats vurdering — handelsprisen kan være højere';
  const provider=String(market?.kilde||'').startsWith('boligsiden')?'Boligsiden':'Boliga';
  if(String(market?.kilde||'').includes('udbud'))return `${provider} · ${Number(market.aktiveAnnoncer)||0} aktuelle udbud · udbudspriser, ikke gennemførte salg`;
  if(String(market?.kilde||'').startsWith('boliga'))return `${provider} · ${Number(market.compsCount)||0} lokale salg · seneste 12 måneder`;
  return 'Markedsdata mangler';
}

// Pure snapshot builder: no email, provider calls, payment or persisted data mutation.
export function buildMonitoringSnapshot(ab={},rates={},market={},now=new Date()) {
  const actual=ab.currentPayment ?? ab.baselinePayment;
  const currentPayment=finite(actual)&&Number(actual)>0 ? Math.round(Number(actual)) : null;
  const debt=finite(ab.restgaeld)&&Number(ab.restgaeld)>0?Number(ab.restgaeld):null;
  const years=finite(ab.loebetid)&&Number(ab.loebetid)>0&&Number(ab.loebetid)<=50?Number(ab.loebetid):null;
  const value=finite(market.markedsvaerdi)&&Number(market.markedsvaerdi)>0?Number(market.markedsvaerdi):null;
  const knownSource=/^(boliga(?:-udbud|-omraade|-omraade-udbud)?|boligsiden-(?:udbud|omraade-udbud)|ev)$/.test(market.kilde||'');
  const missingData=[];
  if(!currentPayment)missingData.push('currentPayment');
  if(!debt)missingData.push('restgaeld');
  if(!years)missingData.push('loebetid');
  if(!value||!knownSource)missingData.push('marketValue');
  const referenceKeys=['F1','F3','F5','fastforrentet'].filter(key=>finite(rates[key])&&Number(rates[key])>=0&&Number(rates[key])<=30);
  const candidates=referenceKeys;
  const availabilityNote='F1, F3, F5 og fast rente er lånetyper på markedet, men ikke alle banker tilbyder alle typer. Renter og bidrag er modelestimater, ikke personlige tilbud. Banken skal godkende lånet.';
  if(!candidates.length)missingData.push('rates');
  const fallbackRates=!rates.source || /fallback/i.test(String(rates.source)) || rates.fallback===true;
  const fee=debt ? Math.round(15000+.005*debt) : null;
  const isInterestOnly=ab.laantype==='afdragsfri';
  const basisNote=`Nye scenarier er med afdrag og anslået bidrag over den oplyste resterende løbetid.${isInterestOnly?' Din nuværende betaling er uden afdrag; ændringen er en forskel i betaling, ikke en ren økonomisk besparelse.':''} Restgæld og nuværende betaling er senest oplyste tal, ikke en bankopdatering. Ingen automatisk gældsafvikling er antaget; opdatér oplysningerne, hvis lånet har ændret sig. ${availabilityNote}`;
  const result={availabilityNote,scenarios:[],rateSource:String(rates.source||'fallback'),rateObservationDate:rates.observationDate||null,rateNote:rates.note||'',currentPayment,newPayment:null,delta:null,monthlyReduction:0,fee,breakEvenMonths:null,canAlert:false,value,equity:value&&debt?Math.round(value-debt):null,sourceLabel:sourceLabel(market),rate:null,rateKey:null,basisNote,missingData,fallbackRates,asOf:new Date(now).toISOString(),paymentBasis:'med afdrag',changeLabel:'Ændring i månedlig betaling'};
  if(!debt||!years||!value||!knownSource||!referenceKeys.length)return result;
  const bidrag=contribution(debt/value*100);
  const scenarios=referenceKeys.map(key=>({rateKey:key,eligibleForNewLoan:true,label:key==='F1'?'F1 Flekslån':key==='fastforrentet'?'Fast rente':key,rate:Number(rates[key]),newPayment:Math.round(payment(debt,Number(rates[key]),years,bidrag))}));
  Object.assign(result,{scenarios,bidrag});
  if(!candidates.length)return result;
  const best=scenarios.filter(row=>row.eligibleForNewLoan).reduce((a,b)=>a.newPayment<=b.newPayment?a:b);
  Object.assign(result,best);
  if(currentPayment===null)return result;
  result.delta=best.newPayment-currentPayment;
  result.monthlyReduction=Math.max(0,-result.delta);
  result.breakEvenMonths=result.monthlyReduction>0?Math.ceil(fee/result.monthlyReduction):null;
  const minimum=finite(ab.alertYdelseKr)&&Number(ab.alertYdelseKr)>0?Number(ab.alertYdelseKr):1000;
  result.canAlert=!missingData.length&&!fallbackRates&&result.monthlyReduction>=minimum&&result.breakEvenMonths!==null&&result.breakEvenMonths<60;
  return result;
}


// Bank-dialogue signals are gross indications, deliberately separate from net-benefit alerts.
const eventNumber=(value,min=0,max=100000000)=>{
 if(typeof value!=='number'&&!(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim())))return null;
 const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null;
};
export function monitoringDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const d=new Date(value+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value?value:null;
}
const dayNumber=value=>Date.parse(value+'T00:00:00Z')/86400000;
const localDay=now=>{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=type=>parts.find(p=>p.type===type).value;return part('year')+'-'+part('month')+'-'+part('day');
};
export function buildMonitoringEvents(ab={},market={},comparison=null,now=new Date()){
 now=new Date(now);if(!Number.isFinite(+now))return [];
 const today=localDay(now),todayNumber=dayNumber(today),events=[];
 const money=n=>Math.round(n).toLocaleString('da-DK')+' kr.';
 const dateLabel=iso=>new Date(iso+'T12:00:00Z').toLocaleDateString('da-DK',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Copenhagen'});
 const reminder=(kind,date,title,body,approximate=false)=>{
  const iso=monitoringDate(date);if(!iso)return;
  const days=dayNumber(iso)-todayNumber;
  if(days>120||days< -30)return;
  const stage=days<0?'passed':days<=30?'30':days<=60?'60':'120';
  events.push({key:kind+':'+iso+':'+stage,kind,title,text:body(iso,days)+(approximate?' Datoen er anslået ud fra dine oplyste resterende år; få den præcise dato bekræftet af banken.':''),eventDate:iso,daysUntil:days,approximate});
 };
 const ref=monitoringDate(ab.refinansiering),deadline=monitoringDate(ab.opsigelsesfrist);
 reminder('refinancing',ref,'Din refinansiering nærmer sig',(date,days)=>days<0?
  'Din oplyste refinansieringsdato var '+dateLabel(date)+'. Opdatér dato, rente, ydelse og eventuelle frister fra banken.':
  'Din oplyste refinansiering er '+dateLabel(date)+'. Kontakt banken nu, hvis du vil undersøge ændringer, og få din konkrete ændrings- eller opsigelsesfrist bekræftet. En almindelig betalingstermin er ikke nødvendigvis et tidspunkt, hvor lånet kan indfries til kurs 100. Rentetilpasning fjerner ikke alle gebyrer ved omlægning.');
 reminder('deadline',deadline,'Bankens oplyste frist',(date,days)=>days<0?
  'Din oplyste frist var '+dateLabel(date)+'. Kontakt banken om de muligheder, der stadig er åbne.':
  'Du har oplyst en ændrings- eller opsigelsesfrist den '+dateLabel(date)+'. Kontakt banken inden denne dato; vent ikke til selve rentetilpasningen.');
 let ioEnd=monitoringDate(ab.afdragsfriSlut),approximate=false;
 if(!ioEnd&&ab.laantype==='afdragsfri'){
  const years=eventNumber(ab.afdragsfriAar,0,50),anchor=monitoringDate(String(ab.loanDataAsOf||ab.createdAt||'').slice(0,10));
  if(years!==null&&anchor){const d=new Date(anchor+'T12:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+Math.round(years*12));const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));ioEnd=d.toISOString().slice(0,10);approximate=true;}
 }
 if(ab.laantype==='afdragsfri')reminder('interest_only_end',ioEnd,'Din afdragsfrihed udløber',(date,days)=>days<0?
  'Din oplyste afdragsfrihed udløb '+dateLabel(date)+'. Kontrollér den nye betaling og opdatér dine lånetal.':
  'Din afdragsfrihed '+(approximate?'forventes at udløbe ':'udløber ')+dateLabel(date)+'. Bed banken beregne din betaling med afdrag og afklare muligheder og frister, før perioden slutter.',approximate);
 const debt=eventNumber(ab.restgaeld,.01),value=eventNumber(market.markedsvaerdi,1,500000000);
 const supportedHome=['110','120','121','122','130','131','132','140'].includes(String(ab.anvKode));
 const currentMarket=/^(boliga(?:-udbud|-omraade|-omraade-udbud)?|boligsiden-(?:udbud|omraade-udbud))$/.test(market.kilde||'');
 if(debt&&value&&supportedHome&&currentMarket){
  const ltv=debt/value*100,threshold=ltv<=40?40:ltv<=60?60:null;
  if(threshold!==null){
   const previous=eventNumber(ab.lastMonitoredLtv,0,1000),crossed=previous!==null&&previous>threshold;
   events.push({key:'ltv:'+threshold+(crossed?':'+today.slice(0,7):''),kind:'ltv',threshold,title:'Bed banken se på din belåningsgrad',text:'Din estimerede belåning er '+ltv.toLocaleString('da-DK',{maximumFractionDigits:1})+' % og dermed højst '+threshold+' %. '+(crossed?'Den seneste kontrol lå over denne grænse. ':'')+'Kontakt banken og spørg, om en ny vurdering eller ændring af lånet kan give lavere bidrag. Banken skal godkende værdien og vilkårene. Lavere belåning giver ikke automatisk lavere bidrag ved næste termin. '+(ref?'Din oplyste refinansiering er '+dateLabel(ref)+'. Bed om bankens frist i god tid.':'Få banken til at oplyse det relevante tidspunkt og fristen; vi kender ikke din næste refinansiering.')});
  }
 }
 const current=eventNumber(ab.currentPayment,.01,1000000),term=eventNumber(ab.loebetid,1,50);
 const observed=comparison?.asOf&&Date.parse(comparison.asOf);
 const fresh=Number.isFinite(observed)&&+now-observed>= -300000&&+now-observed<=4*86400000;
 const rows=fresh&&Array.isArray(comparison.rankedRows)?comparison.rankedRows.filter(row=>row?.isComparable===true&&row.goal==='refinance'&&row.termYears===term&&row.repayment===(ab.laantype==='afdragsfri'?'interestOnly':'amortizing')&&eventNumber(row.monthlyPayment,.01,1000000)!==null&&eventNumber(row.loanAmount,.01)!==null):[];
 const threshold=eventNumber(ab.alertYdelseKr,3000,1000000)??3000;
 const monthly=rows.filter(row=>current!==null&&current-row.monthlyPayment>=threshold).sort((a,b)=>a.monthlyPayment-b.monthlyPayment)[0];
 if(monthly){
  const amount=current-monthly.monthlyPayment;
  events.push({key:'payment:'+today.slice(0,7),kind:'payment',amount,title:'Mulighed for mindst '+money(threshold)+' lavere betaling pr. måned',text:'Et undersøgt lån hos '+monthly.providerName+' viser beregnet '+money(amount)+' lavere betaling pr. måned end dine senest oplyste tal, med samme løbetid og afdragsform. Det er før ukendte omlægnings- og indfrielsesomkostninger og er ikke en dokumenteret nettobesparelse. Renterisiko, gæld og vilkår kan være anderledes. Bed din egen bank om en konkret sammenligning. '+(ref?'Din oplyste refinansiering er '+dateLabel(ref)+'; få bankens frist bekræftet, før du afventer denne dato.':'Vi kender ikke dit relevante indfrielsestidspunkt; bed banken oplyse dato og omkostninger.')});
 }
 const priceDate=monitoringDate(ab.redemptionPriceDate),price=eventNumber(ab.redemptionPrice,1,120);
 const priceAge=priceDate?todayNumber-dayNumber(priceDate):null;
 const isFixed=ab.laantype==='fastforrentet'||ab.underlyingLaantype==='fastforrentet';
 const currentRate=eventNumber(ab.rente,0,30);
 const fixedAlternatives=fresh&&Array.isArray(comparison.rankedRows)?comparison.rankedRows.filter(row=>row?.isComparable===true&&row.goal==='refinance'&&row.productClass==='fixed'&&row.termYears===term&&eventNumber(row.nominalRate,0,30)!==null):[];
 if(isFixed&&currentRate!==null&&(price===null||priceAge===null||priceAge<0||priceAge>7)){
  const higher=fixedAlternatives.filter(row=>row.nominalRate-currentRate>=1).sort((a,b)=>a.nominalRate-b.nominalRate)[0];
  if(higher)events.push({key:'conversion_review:'+today.slice(0,7),kind:'conversion_review',title:'Undersøg muligheden for opkonvertering',text:'Du har oplyst et fastforrentet lån med '+currentRate+' % rente. Blandt de undersøgte nye fastforrentede lån findes '+higher.nominalRate+' % rente. En højere markedsrente kan give mulighed for at indfri det gamle obligationslån under kurs 100, men vi mangler en aktuel indfrielseskurs og kan ikke opgøre en gældsreduktion. Bed banken beregne kurs, ny gæld, betaling og omkostninger. Den højere rente kan gøre lånet dyrere over tid; der er ikke dokumenteret en samlet besparelse eller 200.000 kr. lavere gæld.'});
 }

 // No debt-reduction claim from an assumed par redemption or an undated old quote.
 if(debt&&['fastforrentet','F1','F3','F5'].includes(ab.underlyingLaantype||ab.laantype)&&price!==null&&priceAge!==null&&priceAge>=0&&priceAge<=7){
  const minimum=eventNumber(ab.alertRestgaeldKr,200000,100000000)??200000;
  const candidate=fixedAlternatives.filter(row=>eventNumber(row.loanAmount,.01)!==null&&eventNumber(row.monthlyPayment,.01,1000000)!==null&&debt-row.loanAmount>=minimum&&row.initialNetFinancing!==null&&Math.abs(row.initialNetFinancing-debt*price/100)<2).sort((a,b)=>a.loanAmount-b.loanAmount)[0];
  if(candidate){const amount=debt-candidate.loanAmount;events.push({key:'debt:'+today.slice(0,7),kind:'debt',amount,title:'Mulig gældsreduktion på mindst '+money(minimum),text:'Med din oplyste indfrielseskurs '+price+' fra '+dateLabel(priceDate)+' og den undersøgte nye lånekurs kan den nominelle gæld blive ca. '+money(amount)+' lavere før ukendte omkostninger. Den beregnede nye betaling er '+money(candidate.monthlyPayment)+' pr. måned. En lavere gæld er ikke en samlet besparelse; højere rente og bidrag kan opveje gældsreduktionen. Bed banken bekræfte indfrielsen, omkostningerne og konsekvensen over tid. Vent ikke automatisk til termin: indfrielseskursen kan ændre sig.'+(!isFixed?' For kontantlån kan en kursgevinst være skattepligtig. Skat er ikke medregnet; få det afklaret af banken.':'')});}
 }
 return events;
}
