const numeric = (value,min,max) => {
  if(typeof value!=='number'&&!(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim())))return null;
  const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null;
};
const id = value => typeof value==='string'?value:value?.id;
const instant = value => typeof value==='string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString():null;
export function parseComparisonLoan(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const restgaeld=numeric(input.restgaeld,1,100000000),rente=numeric(input.rente,0,30),loebetid=numeric(input.loebetid,1,50);
  const propertyValue=numeric(input.propertyValue??input.value??input.ejd,100000,500000000);
  if(restgaeld===null||rente===null||loebetid===null||propertyValue===null||!['F1','F3','F5','fastforrentet','afdragsfri'].includes(input.laantype))return null;
  const optional={currentPayment:[0,1000000],currentBidrag:[0,10],afdragsfriAar:[0,50],redemptionPrice:[0,200],redemptionFee:[0,10000000],newDebt:[1,100000000],newTermYears:[1,50]};
  const loan={restgaeld,rente,loebetid,propertyValue,laantype:input.laantype,anvKode:['110','120','121','122','130','131','132','140','510'].includes(String(input.anvKode))?String(input.anvKode):null};
  for(const [field,[min,max]]of Object.entries(optional))loan[field]=numeric(input[field],min,max);
  loan.productClass='fixed';
  loan.underlyingLaantype=['F1','F3','F5','fastforrentet'].includes(input.underlyingLaantype)?input.underlyingLaantype:null;
  loan.newRepayment=['amortizing','interestOnly'].includes(input.newRepayment)?input.newRepayment:'amortizing';
  loan.newInterestOnlyYears=numeric(input.newInterestOnlyYears,0,50);
  loan.financeSwitchCosts=input.financeSwitchCosts===true;
  loan.institution=['Nordea','Nordea Kredit','Nykredit','Totalkredit','Realkredit Danmark','Jyske','Jyske Realkredit'].includes(input.institution)?input.institution:null;
  return loan;
}
// Explicit server whitelist: never spread engine output or catalogue objects into a free response.
export function comparisonTeaser(result={}) {
  const t=result?.teaser||{},c=t.coverage||{};
  const coverage={};for(const key of ['providerCount','offerCount','matchedProviderCount','matchedOfferCount','excludedOfferCount'])coverage[key]=numeric(c[key],0,100000)??0;
  coverage.asOf=instant(c.asOf);
  return {scopeLabel:typeof t.scopeLabel==='string'?t.scopeLabel.replace(/[\u0000-\u001f<>]/g,' ').slice(0,160):'',status:typeof t.status==='string'&&/^[a-z_]{1,40}$/.test(t.status)?t.status:'unavailable',
    netBenefit5YearsRounded:numeric(t.netBenefit5YearsRounded,-500000000,500000000),
    modelPriceSpread5YearsRounded:numeric(t.modelPriceSpread5YearsRounded,0,500000000),
    annualContributionSpreadRounded:numeric(t.annualContributionSpreadRounded,0,10000000),
    horizonMonths:numeric(t.horizonMonths,1,600),eligibleCount:numeric(t.eligibleCount,0,100000)??0,asOf:instant(t.asOf),coverage,
    missingInputs:Array.isArray(t.missingInputs)?t.missingInputs.filter(key=>typeof key==='string'&&/^[a-zA-Z][a-zA-Z0-9_.]{0,60}$/.test(key)).slice(0,30):[]};
}
export function hasUnrefundedPayment(payment,amount) {
  const charge=payment?.latest_charge;
  return !!(payment&&typeof payment==='object'&&payment.status==='succeeded'&&payment.currency==='dkk'&&
    Number.isSafeInteger(payment.amount_received)&&payment.amount_received>=amount&&charge&&typeof charge==='object'&&
    charge.paid===true&&charge.refunded===false&&charge.disputed===false&&charge.amount_refunded===0&&
    charge.currency==='dkk'&&Number.isSafeInteger(charge.amount)&&charge.amount>=amount);
}
export function isPaidBankComparisonCheckout(checkout,order) {
  return !!(order&&order.checkoutId===checkout?.id&&checkout.mode==='payment'&&checkout.status==='complete'&&
    checkout.payment_status==='paid'&&checkout.currency==='dkk'&&checkout.metadata?.type==='bankpakke'&&
    Number.isSafeInteger(order.amount)&&order.amount>0&&checkout.amount_total===order.amount&&hasUnrefundedPayment(checkout.payment_intent,order.amount));
}
export function isPaidSubscriptionComparison(checkout,subscription,subscriber,now=Date.now()) {
  if(!checkout||!subscription||!subscriber)return false;
  const amount=Number(checkout.metadata?.expectedAmount??checkout.amount_total),annual=['aar','aarlig'].includes(checkout.metadata?.periode||subscriber.periode);
  const invoice=subscription.latest_invoice;
  return !!((subscriber.subscriptionStatus||subscriber.status)==='active'&&checkout.id===subscriber.stripeCheckoutId&&
    checkout.mode==='subscription'&&checkout.status==='complete'&&checkout.payment_status==='paid'&&checkout.currency==='dkk'&&
    checkout.metadata?.type==='laanovervagning'&&Number.isSafeInteger(amount)&&amount>=(annual?10000:4900)&&amount<=(annual?39900:4900)&&checkout.amount_total===amount&&
    id(checkout.subscription)===subscriber.stripeSubscriptionId&&subscription.id===subscriber.stripeSubscriptionId&&
    id(checkout.customer)===subscriber.stripeCustomerId&&id(subscription.customer)===subscriber.stripeCustomerId&&
    subscription.status==='active'&&Number.isFinite(subscription.current_period_end)&&subscription.current_period_end*1000>Number(new Date(now))&&
    invoice&&typeof invoice==='object'&&invoice.status==='paid'&&invoice.paid===true&&invoice.currency==='dkk'&&
    id(invoice.subscription)===subscription.id&&id(invoice.customer)===subscriber.stripeCustomerId&&Number.isSafeInteger(invoice.amount_paid)&&invoice.amount_paid>0&&
    hasUnrefundedPayment(invoice.payment_intent,invoice.amount_paid));
}
export function comparisonAlertSignal(comparison,subscriber={}) {
  const threshold=numeric(subscriber.alertYdelseKr,1,1000000)??1000;
  if(comparison?.teaser?.status!=='net_benefit'||!(comparison.teaser?.coverage?.matchedProviderCount>=2))return {canAlert:false,monthlyReduction:0};
  const row=(Array.isArray(comparison.rankedRows)?comparison.rankedRows:[]).find(row=>row?.isComparable===true&&row.eligibleForPersonalComparison===true&&row.costsKnown===true&&
    typeof row.netBenefit5Years==='number'&&Number.isFinite(row.netBenefit5Years)&&row.netBenefit5Years>0&&typeof row.monthlyDifference==='number'&&Number.isFinite(row.monthlyDifference)&&-row.monthlyDifference>=threshold&&
    typeof row.breakEvenMonths==='number'&&Number.isFinite(row.breakEvenMonths)&&row.breakEvenMonths>=0&&row.breakEvenMonths<=60);
  return row?{canAlert:true,monthlyReduction:-row.monthlyDifference,netBenefit5Years:row.netBenefit5Years,row}:{canAlert:false,monthlyReduction:0};
}
