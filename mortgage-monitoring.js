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
