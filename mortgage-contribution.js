export const CONTRIBUTION_SOURCES=Object.freeze([
 Object.freeze({name:'Realkredit Danmark — prisblad privat',url:'https://rd.dk/PDF/Privat/Prisblad-privat.pdf',assessed:'2026-11-03',effective:'2026-09-23'}),
 Object.freeze({name:'Nordea Kredit — bidragssatser',url:'https://www.nordea.dk/Images/144-119161/20170105bidragssatser.pdf',assessed:'2026-11-03',effective:'2026-02-23'})
]);
const numeric=(value,min,max)=>{
 if(typeof value!=='number'&&!(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim())))return null;
 const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null;
};
export function estimateContributionOpportunity(input={}) {
 const restgaeld=numeric(input.restgaeld,0,100000000),value=numeric(input.value,.01,500000000);
 const currentBidrag=numeric(input.currentBidrag,0,10),targetBidrag=numeric(input.targetBidrag,0,10);
 const oneOffCosts=numeric(input.oneOffCosts,0,100000000);
 const code=String(input.anvKode??'');
 const dwelling=['110','120','121','122','130','131','132','140'].includes(code);
 const summer=code==='510';
 const ltv=restgaeld!==null&&value!==null?restgaeld/value*100:null;
 const thresholdPercent=dwelling?60:null;
 const debtTo60=dwelling&&ltv!==null?Math.max(0,restgaeld-value*.6):null;
 const missingData=[];
 if(restgaeld===null)missingData.push('restgaeld');
 if(value===null)missingData.push('value');
 if(currentBidrag===null)missingData.push('currentBidrag');
 const scenario=cut=>{
  cut=Number(cut.toFixed(10));
  const monthly=restgaeld*cut/1200;
  return {cutPercentagePoints:cut,monthly,yearly:monthly*12,breakEvenMonths:oneOffCosts!==null&&monthly>0?Math.ceil(oneOffCosts/monthly):null};
 };
 const illustrations=restgaeld!==null?[.10,.20,.30].filter(cut=>currentBidrag===null||cut<=currentBidrag).map(scenario):[];
 const actualScenario=restgaeld!==null&&currentBidrag!==null&&targetBidrag!==null&&targetBidrag<currentBidrag?scenario(currentBidrag-targetBidrag):null;
 const notes=[
  'Beløbene er før skat og beregnes på den oplyste restgæld. En lavere bidragssats kræver bankens eller realkreditinstituttets konkrete vilkår og godkendelse.',
  'En lavere belåningsgrad giver ikke automatisk en lavere sats på et eksisterende lån. Låntype, afdragsfrihed, belåningsintervaller og historiske aftaler kan påvirke bidraget.',
  actualScenario?'Beregningen bruger dine oplyste nuværende og mulige nye bidragssatser. Den nye sats er ikke verificeret som et bindende tilbud.':'Scenarierne er hypotetiske fald i procentpoint, ikke tilbud eller bestemte långiveres priser.',
  currentBidrag===null?'Din nuværende bidragssats er ikke oplyst. Illustrationerne dokumenterer derfor ikke en faktisk besparelse på dit lån.':null,
  oneOffCosts===null?'Engangsomkostninger er ukendte. Tilbagebetalingstid kan derfor ikke fastslås.':'Tilbagebetalingstiden bruger de oplyste engangsomkostninger og en uændret restgæld; faktiske betalinger kan ændre sig.',
  summer?'Sommerhuse har andre belåningsintervaller, som varierer mellem institutter. Der vises derfor ingen fælles grænse for sommerhuse.':!dwelling?'Boligtypen er ikke kendt; en relevant belåningsgrænse kan ikke fastslås.':null
 ].filter(Boolean);
 return {restgaeld,value,ltv,thresholdPercent,debtTo60,currentBidrag,targetBidrag,oneOffCosts,
  hypothetical:actualScenario===null,actualScenario,illustrations,missingData,notes,sources:CONTRIBUTION_SOURCES};
}
