// Pure comparison model. No provider calls, storage, payments or customer delivery.
const num=(value,min=0,max=100000000)=>{
 if(typeof value!=='number'&&!(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim())))return null;
 const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null;
};
const money=value=>Math.round(value)||0;
const text=(value,max=250)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
const url=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const classOf=value=>({fastforrentet:'fixed',fixed:'fixed',F1:'F1',F3:'F3',F5:'F5',short:'short',Fkort:'short','F-kort':'short'})[value]||null;
const day=24*60*60*1000;
const stamp=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))return null;const date=value.slice(0,10),n=Date.parse(value);return Number.isFinite(n)&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date?n:null;};
const annualPayment=(debt,rate,months)=>rate===0?debt/months:debt*(rate/1200)/(1-(1+rate/1200)**-months);
const roundedPublic=value=>value>=100?Math.floor(value/100)*100:null;

function monthDate(start,offset){
 const date=new Date(start),year=date.getUTCFullYear(),month=date.getUTCMonth()+offset;
 return Date.UTC(year,month,Math.min(date.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate()),date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds(),date.getUTCMilliseconds());
}
function discountCut(discounts,start,month){
 const from=monthDate(start,month),to=monthDate(start,month+1);
 return discounts.reduce((sum,discount)=>{
  const begins=discount.startsAt?stamp(discount.startsAt):-Infinity;
  const end=stamp(discount.endsAt)+(discount.endsAt.length===10?day:0);
  const overlap=Math.max(0,Math.min(to,end)-Math.max(from,begins));
  return sum+discount.annualPercentagePoints*overlap/(to-from);
 },0);
}
function automaticDiscounts(offer,now){
 return (Array.isArray(offer.discounts)?offer.discounts:[]).filter(discount=>discount&&discount.conditional===false&&discount.automaticInComparison===true&&num(discount.annualPercentagePoints,0,5)!==null&&stamp(discount.endsAt)!==null&&stamp(discount.endsAt)+(discount.endsAt.length===10?day:0)>now&&(!discount.startsAt||stamp(discount.startsAt)!==null)&&url(discount.sourceUrl)).map(discount=>({name:text(discount.name,100),annualPercentagePoints:Number(discount.annualPercentagePoints),startsAt:discount.startsAt||null,endsAt:discount.endsAt,sourceUrl:url(discount.sourceUrl)}));
}
function publishedFeeComponents(fees,principal){
 return (Array.isArray(fees?.components)?fees.components:[]).map(component=>{
  const name=text(component?.name,120),kind=['fixed','percentage','maximum','tiered'].includes(component?.kind)?component.kind:'unknown';
  const amount=num(component?.amount,0,10000000),percentage=num(component?.percentage,0,10),minimum=num(component?.min,0,10000000),maximum=num(component?.max,0,10000000);
  let estimatedAmount=null,estimateKind='not_computed';
  if(kind==='fixed'&&amount!==null){estimatedAmount=amount;estimateKind='published_fixed';}
  if(kind==='percentage'&&percentage!==null&&component.basis==='nominal'){estimatedAmount=Math.min(maximum??Infinity,Math.max(minimum??0,principal*percentage/100));estimateKind='published_percentage';}
  if(kind==='maximum'&&amount!==null){estimatedAmount=amount;estimateKind='published_maximum_not_actual_fee';}
  const tiers=kind==='tiered'&&Array.isArray(component.tiers)?component.tiers.map(tier=>({upTo:tier.upTo===null?null:num(tier.upTo,0),percentage:num(tier.percentage,0,10),min:num(tier.min,0,10000000),max:num(tier.max,0,10000000)})):[];
  return {name,kind,amount,percentage,basis:component?.basis==='nominal'?'nominal':'not_confirmed',min:minimum,max:maximum,estimatedAmount:estimatedAmount===null?null:money(estimatedAmount),estimateKind,tiers};
 }).filter(component=>component.name);
}
// Contribution brackets are annual percentages; interestOnlyRate is the full IO rate,
// not a surcharge. The weighted initial rate is applied to the falling balance.
export function weightedContributionRate(contribution,debt,value,repayment='amortizing'){
 if(!contribution||!Array.isArray(contribution.tiers)||!(debt>0&&value>0))return null;
 let previous=0,total=0;
 for(const tier of contribution.tiers){
  const upper=num(tier?.upToLtv,0,100),rate=num(repayment==='interestOnly'?tier?.interestOnlyRate:tier?.rate,0,15);
  if(upper===null||upper<=previous||rate===null)return null;
  const slice=Math.max(0,Math.min(debt,value*upper/100)-value*previous/100);
  total+=slice*rate;previous=upper;
 }
 return debt>value*previous/100+.01?null:total/debt;
}

// Cash payments plus residual debt minus starting debt retains the economic cost
// while keeping principal repayment separate from expense. Contributions are not
// folded into the interest rate used to amortize principal.
export function projectMortgageCashflows({principal,nominalRate,bidragRate,termMonths,interestOnlyMonths=0,horizonMonths=60,actualMonthlyPayment=null,discountPeriods=[],asOf=null,minimumAnnualContribution=0}){
 if(num(principal,.01)===null||num(nominalRate,0,30)===null||num(bidragRate,0,15)===null||!Number.isInteger(termMonths)||termMonths<1||termMonths>600||!Number.isInteger(interestOnlyMonths)||interestOnlyMonths<0||interestOnlyMonths>termMonths||!Number.isInteger(horizonMonths)||horizonMonths<1)return null;
 const horizon=Math.min(horizonMonths,termMonths),initial=principal;
 if(discountPeriods.length&&(!asOf||!Number.isFinite(+new Date(asOf))))return null;
 const minimum=num(minimumAnnualContribution,0,1000000);if(minimum===null)return null;
 const observed=actualMonthlyPayment===null?null:num(actualMonthlyPayment,.01,10000000);
 if(actualMonthlyPayment!==null&&observed===null)return null;
 let balance=principal,cash=0,interestTotal=0,bidragTotal=0,firstPayment=null;
 const periods=[{month:0,cashPaid:0,remainingDebt:balance,economicCost:0}];
 for(let month=0;month<horizon;month++){
  const interest=balance*nominalRate/1200;
  const effectiveBidrag=Math.max(0,bidragRate-(discountPeriods.length?discountCut(discountPeriods,+new Date(asOf),month):0));
  const bidrag=Math.max(balance*effectiveBidrag/1200,minimum/12);
  const io=month<interestOnlyMonths;
  let principalPaid=io?0:annualPayment(balance,nominalRate,termMonths-month)-interest;
  // The observed payment describes the current phase; IO ending triggers a new
  // annuity over the remaining term rather than pretending IO lasts forever.
  if(observed!==null&&(interestOnlyMonths===0||io)){
   if(!io){principalPaid=observed-interest-bidrag;if(principalPaid<-.01)return null;}
  }
  principalPaid=Math.min(balance,Math.max(0,principalPaid));
  if(month===termMonths-1)principalPaid=balance;
  const payment=observed!==null&&(interestOnlyMonths===0||io)?(io?observed:Math.min(observed,interest+bidrag+principalPaid)):interest+bidrag+principalPaid;
  const finalPayment=month===termMonths-1?interest+bidrag+principalPaid:payment;
  if(firstPayment===null)firstPayment=finalPayment;
  balance=Math.max(0,balance-principalPaid);cash+=finalPayment;interestTotal+=interest;bidragTotal+=bidrag;
  periods.push({month:month+1,cashPaid:cash,remainingDebt:balance,economicCost:cash+balance-initial});
 }
 return {monthlyPayment:firstPayment,cashPaid:cash,remainingDebt:balance,economicCost:cash+balance-initial,interestPaid:interestTotal,bidragPaid:bidragTotal,horizonMonths:horizon,periods};
}

function freshness(offer,now){
 const checked=stamp(offer.checkedAt),observed=stamp(offer.rateObservedAt),effective=stamp(offer.effectiveDate),expiry=stamp(offer.expiry||offer.expiresAt);
 if(checked===null||checked>now+60000||effective===null||effective>now)return null;
 if(expiry!==null&&expiry<=now)return null;
 for(const limit of [offer.priceListExpiresAt,offer.contribution?.expiresAt]){if(limit!==undefined&&(stamp(limit)===null||stamp(limit)<=now))return null;}
 const contributionEffective=stamp(offer.contribution?.effectiveDate);
 if(contributionEffective===null||contributionEffective>now||!url(offer.contribution?.sourceUrl))return null;
 if(observed!==null){if(observed>now+60000||now-observed>7*day||now-checked>day)return null;return 'dated_source';}
 if(offer.sourceFreshness==='live-retrieval'&&expiry!==null&&now-checked<=30*60000)return 'live_retrieval_observation_unknown';
 return null;
}
function currentBaseline(loan,debt,termMonths,horizon,discounts=[],asOf=null){
 const missing=[];
 const rate=num(loan.rente,0,30),bidrag=num(loan.currentBidrag,0,15),payment=num(loan.currentPayment,.01,10000000);
 const currentClass=classOf(loan.underlyingLaantype)||classOf(loan.laantype);
 const io=loan.laantype==='afdragsfri'||loan.afdragsfri===true;
 const ioYears=io?num(loan.afdragsfriAar,0,50):0;
 if(rate===null)missing.push('currentNominalRate');if(bidrag===null)missing.push('currentBidrag');if(payment===null)missing.push('currentPayment');
 if(discounts.length&&typeof loan.currentBidragIncludesDiscount!=='boolean')missing.push('currentDiscountBasis');
 if(!currentClass)missing.push('currentProductClass');if(ioYears===null||ioYears*12>termMonths)missing.push('remainingInterestOnlyPeriod');
 const projection=missing.length?null:projectMortgageCashflows({principal:debt,nominalRate:rate,bidragRate:bidrag+(discounts.length&&loan.currentBidragIncludesDiscount===true?discountCut(discounts,+new Date(asOf),0):0),discountPeriods:discounts,asOf,termMonths,interestOnlyMonths:Math.round(ioYears*12),horizonMonths:horizon,actualMonthlyPayment:payment});
 if(!projection&&!missing.length)missing.push('currentPaymentConsistency');
 return {projection,missing,currentClass};
}

export function compareMortgageMarket(input={}){
 const loan=input.loan&&typeof input.loan==='object'?input.loan:{};
 const offers=Array.isArray(input.offers)?input.offers:[];
 const now=new Date(input.now??new Date()),nowMs=+now;
 const asOf=Number.isFinite(nowMs)?now.toISOString():null;
 const goal=['borrow','repay'].includes(input.goal)?input.goal:'refinance';
 const debt=num(loan.restgaeld,.01),value=num(loan.propertyValue??loan.value??loan.ejd,1,500000000);
 const currentYears=num(loan.loebetid,1,50),termYears=num(loan.newTermYears??loan.loebetid,1,50);
 const targetDebt=goal==='refinance'?debt:num(loan.newDebt,.01);
 const targetClass=classOf(loan.productClass??loan.riskClass)||classOf(loan.underlyingLaantype)||classOf(loan.laantype)||'fixed';
 const repayment=loan.newRepayment==='interestOnly'?'interestOnly':'amortizing';
 const newIOYears=repayment==='interestOnly'?num(loan.newInterestOnlyYears,1/12,50):0;
 const redemptionPrice=num(loan.redemptionPrice,1,120),redemptionFee=num(loan.redemptionFee,0,10000000);
 const missingInputs=[];
 if(debt===null)missingInputs.push('restgaeld');if(value===null)missingInputs.push('propertyValue');if(currentYears===null)missingInputs.push('loebetid');if(termYears===null)missingInputs.push('newTermYears');if(targetDebt===null)missingInputs.push('newDebt');
 const wrongDirection=debt!==null&&targetDebt!==null&&((goal==='borrow'&&targetDebt<=debt)||(goal==='repay'&&targetDebt>=debt));
 if(wrongDirection)missingInputs.push('goalDebtDirection');
 if(redemptionPrice===null)missingInputs.push('redemptionPrice');if(redemptionFee===null)missingInputs.push('redemptionFee');
 if(repayment==='interestOnly'&&newIOYears===null)missingInputs.push('newInterestOnlyYears');
 const horizon=currentYears!==null&&termYears!==null?Math.min(60,Math.round(currentYears*12),Math.round(termYears*12)):60;
 const providerSet=new Set(offers.map(o=>text(o?.lender)).filter(Boolean));
 const coverage={providerCount:Math.max(providerSet.size,num(input.coverage?.requestedLenders,0,100)??0),offerCount:offers.length,matchedProviderCount:0,matchedOfferCount:0,excludedOfferCount:0,asOf};
 const scopeLabel=termYears===null?'Lån med ufuldstændige forudsætninger':`${termYears}-årige ${targetClass==='fixed'?'fastforrentede':targetClass==='short'?'kortforrentede':targetClass} lån ${repayment==='interestOnly'?'med valgt afdragsfrihed':'med afdrag'}`;
 const assumptions=[
  'Beregninger før skat på en uændret rente og bidragssats over den viste periode; ingen kurs- eller renteprognose.',
  'Rente og bidrag beregnes særskilt på faldende restgæld. Afdrag er gældsafvikling og tælles ikke som en økonomisk omkostning.',
  'Hvert lån bruger kun samme udbyders sammenhørende kupon/rente, nettokurs og bidragsvilkår. Modellen er ikke et bindende tilbud eller en kreditgodkendelse.',
  'Kun den viste risikoklasse, løbetid, afdragsform og finansieringsbehov sammenlignes. Finansieringskursen kan ændre den nye nominelle gæld og belåningsgrad.'
 ];
 const excluded=[],rankedRows=[];
 const critical=wrongDirection||debt===null||value===null||currentYears===null||termYears===null||targetDebt===null||newIOYears===null||!Number.isFinite(nowMs);
 const existingLender=({'Nordea':'nordea','Nordea Kredit':'nordea','Realkredit Danmark':'rd','Totalkredit':'totalkredit'})[loan.institution];
 const currentDiscountOffer=existingLender?offers.find(offer=>offer?.lenderId===existingLender):null;
 const currentDiscounts=currentDiscountOffer?automaticDiscounts(currentDiscountOffer,nowMs):[];
 const baselineModel=!critical?currentBaseline(loan,debt,Math.round(currentYears*12),horizon,currentDiscounts,asOf):{projection:null,missing:[],currentClass:null};
 missingInputs.push(...baselineModel.missing);
 if(redemptionPrice===null)assumptions.push('Indfrielseskursen er ukendt; priseksemplerne forudsætter kurs 100 og kan ikke vise en personlig nettogevinst.');
 if(goal!=='refinance')missingInputs.push('matchedCurrentLoanForChangedDebt');
 if(termYears!==currentYears)missingInputs.push('matchingCurrentTerm');
 if(targetClass!==baselineModel.currentClass)missingInputs.push('matchingCurrentRiskClass');
 for(const offer of offers){
  const id=text(offer?.id),reject=reason=>excluded.push({offerId:id,reason});
  if(critical){reject('missing_inputs');continue;}
  if(!offer||offer.newLoanEligible!==true){reject('not_available_as_new_loan');continue;}
  if(classOf(offer.productClass)!==targetClass){reject('risk_mismatch');continue;}
  if(Array.isArray(offer.supportedPropertyTypes)&&!offer.supportedPropertyTypes.includes(String(loan.anvKode??''))){reject('property_type_not_supported');continue;}
  const offerTerm=num(offer.termYears,1,50),minTerm=num(offer.minTermYears??1,1,50),maxTerm=num(offer.maxTermYears??offer.termYears,1,50);
  if(offerTerm===null||minTerm===null||maxTerm===null||(offer.termIsMaximum===true?(termYears<minTerm||termYears>maxTerm):termYears!==offerTerm)){reject('term_mismatch');continue;}
  if(offer.repayment!==repayment){reject('repayment_mismatch');continue;}
  if(repayment==='interestOnly'&&(num(offer.interestOnlyMaxYears,0,50)===null||newIOYears>offer.interestOnlyMaxYears||newIOYears>termYears)){reject('interest_only_not_matched');continue;}
  const fresh=freshness(offer,nowMs);
  if(!fresh){reject('stale_or_undated_source');continue;}
  const rate=num(offer.nominalRate,0,30),price=num(offer.price,50,120),source=url(offer.sourceUrl),contact=url(offer.contactUrl);
  if(rate===null||price===null||offer.rateIncludesContribution!==false||offer.priceIncludesSpread!==true||!source||!contact||!text(offer.lender)||!text(offer.product)){reject('unmatched_price_or_source');continue;}
  const knownFee=offer.fees?.known===true&&num(offer.fees.amount,0,10000000)!==null;
  const feeAmount=num(offer.fees?.amount,0,10000000);
  const estimate=num(loan.estimatedSwitchCosts,0,10000000);
  const quotedFees=feeAmount??estimate;
  const totalFees=quotedFees===null?null:quotedFees+(redemptionFee??0);
  const financed=loan.financeSwitchCosts===true;
  const netFinancing=targetDebt+debt*((redemptionPrice??100)/100-1);
  if(netFinancing<=0){reject('invalid_financing_need');continue;}
  const principal=(netFinancing+(financed?(totalFees??0):0))/(price/100);
  const minLtv=num(offer.minLtv??0,0,100),maxLtv=num(offer.maxLtv,0,100),ltv=principal/value*100;
  if(minLtv===null||maxLtv===null||ltv<minLtv-.000001||ltv>maxLtv+.000001){reject('ltv_outside_product');continue;}
  const bidrag=weightedContributionRate(offer.contribution,principal,value,repayment);
  const discounts=automaticDiscounts(offer,nowMs);
  const initialDiscount=discounts.length?discountCut(discounts,nowMs,0):0;
  const minimumAnnual=num(offer.contribution.minimumAnnual??0,0,1000000);
  const commonBidrag=weightedContributionRate(offer.contribution,targetDebt,value,repayment);
  if(bidrag===null||minimumAnnual===null){reject('missing_contribution_tier');continue;}
  const projection=projectMortgageCashflows({principal,nominalRate:rate,bidragRate:bidrag,termMonths:Math.round(termYears*12),interestOnlyMonths:Math.round(newIOYears*12),horizonMonths:horizon,discountPeriods:discounts,asOf,minimumAnnualContribution:minimumAnnual});
  if(!projection){reject('invalid_projection');continue;}
  const upfront=financed?0:(totalFees??0);
  const modeledCost=projection.cashPaid+projection.remainingDebt-targetDebt+upfront;
  const costsKnown=knownFee&&redemptionFee!==null&&redemptionPrice!==null&&fresh==='dated_source';
  const currentComparable=goal==='refinance'&&termYears===currentYears&&targetClass===baselineModel.currentClass&&baselineModel.projection!==null;
  const personalComparable=currentComparable&&costsKnown;
  const benefit=personalComparable?baselineModel.projection.economicCost-modeledCost:null;
  let breakEven=null;
  if(personalComparable&&benefit>0){
   const found=projection.periods.find(period=>baselineModel.projection.periods[period.month].economicCost-(period.cashPaid+period.remainingDebt-targetDebt+upfront)>=0);
   breakEven=found?found.month:null;
  }
  const unknownCosts=Array.isArray(offer.fees?.unknown)?offer.fees.unknown.map(v=>text(v,100)).filter(Boolean):[];
  const sources=[{kind:'quote',url:source,effectiveDate:offer.effectiveDate,checkedAt:offer.checkedAt,rateObservedAt:offer.rateObservedAt??null},{kind:'contribution',url:url(offer.contribution.sourceUrl),effectiveDate:offer.contribution.effectiveDate,checkedAt:offer.contribution.checkedAt??offer.checkedAt}];
  for(const discount of discounts)sources.push({kind:'discount',url:discount.sourceUrl,effectiveDate:discount.startsAt,endsAt:discount.endsAt,checkedAt:offer.checkedAt});
  if(url(offer.fees?.sourceUrl))sources.push({kind:'fees',url:url(offer.fees.sourceUrl),effectiveDate:offer.fees.effectiveDate??offer.effectiveDate,checkedAt:offer.checkedAt});
  rankedRows.push({providerId:text(offer.lenderId||offer.lender),productId:id,providerName:text(offer.lender),productName:text(offer.product),productClass:targetClass,contactUrl:contact,sources,
   goal,loanAmount:money(principal),initialNetFinancing:money(netFinancing),comparisonAmount:money(targetDebt),termYears,repayment,interestOnlyMonths:Math.round(newIOYears*12),horizonMonths:horizon,
   nominalRate:rate,price,baseBidragRate:bidrag,bidragRate:Math.max(0,bidrag-initialDiscount),monthlyPayment:money(projection.monthlyPayment),monthlyDifference:goal==='refinance'&&num(loan.currentPayment,.01)!==null?money(projection.monthlyPayment-Number(loan.currentPayment)):null,
   totalCost5Years:costsKnown?money(modeledCost):null,modelCostBeforeUnknownFees:money(modeledCost),remainingDebt5Years:money(projection.remainingDebt),cashPaid5Years:money(projection.cashPaid+upfront),switchCosts:totalFees===null?null:money(totalFees),switchCostsKnown:costsKnown,costsKnown,
   netBenefit5Years:benefit===null?null:money(benefit),breakEvenMonths:breakEven,isComparable:true,eligibleForPersonalComparison:personalComparable,
   benefitStatus:personalComparable?'modeled_personal_comparison':'price_only',comparisonGroup:`${targetClass}:${termYears}:${repayment}:${newIOYears}:${targetDebt}:${horizon}`,freshnessStatus:fresh,unknownCosts,publishedFeeComponents:publishedFeeComponents(offer.fees,principal),
   annualContributionAtSameAmount:commonBidrag===null?null:Array.from({length:12},(_,month)=>Math.max(targetDebt*Math.max(0,commonBidrag-(discounts.length?discountCut(discounts,nowMs,month):0))/1200,minimumAnnual/12)).reduce((sum,value)=>sum+value,0),
   conditionalDiscounts:Array.isArray(offer.discounts)?offer.discounts.map(discount=>({name:text(discount.name,100),annualPercentagePoints:num(discount.annualPercentagePoints,0,10),endsAt:text(discount.endsAt,30),applied:discounts.some(applied=>applied.name===text(discount.name,100)&&applied.endsAt===discount.endsAt)})):[],
   assumptions:[...(discounts.length?discounts.map(discount=>`${discount.name}: ${discount.annualPercentagePoints} procentpoint er kun medregnet til og med ${discount.endsAt}.`):[]),...(!knownFee?['Bank-, formidlings- og øvrige skifteomkostninger er ikke fuldt kendt.']:[]),...(redemptionPrice===null?['Indfrielse forudsat til kurs 100; faktisk kurs mangler.']:[]),...(fresh!=='dated_source'?['Kursens observationstid er ikke oplyst; kun hentetidspunktet er kendt.']:[])]});
 }
 rankedRows.sort((a,b)=>a.comparisonGroup.localeCompare(b.comparisonGroup)||(a.modelCostBeforeUnknownFees-b.modelCostBeforeUnknownFees)||a.providerName.localeCompare(b.providerName));
 let group='',rank=0;for(const row of rankedRows){if(row.comparisonGroup!==group){group=row.comparisonGroup;rank=0;}row.priceRankInGroup=++rank;row.rankInGroup=row.costsKnown&&rankedRows.filter(other=>other.comparisonGroup===row.comparisonGroup).every(other=>other.costsKnown)?rank:null;row.rankBasis=row.rankInGroup===null?'price_components_before_unknown_costs':'modeled_total_cost';}
 const lenders=new Set(rankedRows.map(row=>row.providerName));
 Object.assign(coverage,{matchedProviderCount:lenders.size,matchedOfferCount:rankedRows.length,excludedOfferCount:excluded.length});
 if(rankedRows.some(row=>!row.costsKnown))missingInputs.push('completeSwitchCosts');
 let costSpread=null,bidragSpread=null;
 const groups=new Map();for(const row of rankedRows){if(!groups.has(row.comparisonGroup))groups.set(row.comparisonGroup,[]);groups.get(row.comparisonGroup).push(row);}
 for(const rows of groups.values()){
  if(new Set(rows.map(row=>row.providerName)).size<2)continue;
  if(rows.every(row=>row.costsKnown&&row.totalCost5Years!==null))costSpread=Math.max(costSpread??0,Math.max(...rows.map(row=>row.totalCost5Years))-Math.min(...rows.map(row=>row.totalCost5Years)));
  if(repayment==='amortizing'&&rows.every(row=>row.annualContributionAtSameAmount!==null))bidragSpread=Math.max(bidragSpread??0,Math.max(...rows.map(row=>row.annualContributionAtSameAmount))-Math.min(...rows.map(row=>row.annualContributionAtSameAmount)));
 }
 const positive=rankedRows.filter(row=>row.eligibleForPersonalComparison&&row.netBenefit5Years>0).sort((a,b)=>b.netBenefit5Years-a.netBenefit5Years)[0];
 const benefitRounded=positive?roundedPublic(positive.netBenefit5Years):null;
 const costSpreadRounded=roundedPublic(costSpread??0),bidragSpreadRounded=roundedPublic(bidragSpread??0);
 const status=benefitRounded!==null?'net_benefit':costSpreadRounded!==null||bidragSpreadRounded!==null?'price_comparison':rankedRows.length?'incomplete':'no_match';
 const teaser={status,scopeLabel,horizonMonths:horizon,netBenefit5YearsRounded:benefitRounded,modelPriceSpread5YearsRounded:costSpreadRounded,annualContributionSpreadRounded:bidragSpreadRounded,eligibleCount:rankedRows.length,asOf,coverage,missingInputs:[...new Set(missingInputs)]};
 const baseline=baselineModel.projection?{monthlyPayment:money(baselineModel.projection.monthlyPayment),totalCost5Years:money(baselineModel.projection.economicCost),remainingDebt5Years:money(baselineModel.projection.remainingDebt),horizonMonths:horizon,productClass:baselineModel.currentClass,termYears:currentYears}:null;
 return {rankedRows,teaser,baseline,scopeLabel,horizonMonths:horizon,assumptions,excluded,asOf,coverage};
}
