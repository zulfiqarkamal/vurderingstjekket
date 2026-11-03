import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getMortgageCatalogue,parseLenderOffers,MORTGAGE_LENDER_SOURCES} from '../mortgage-lender-catalogue.js';
const now=new Date('2026-11-03T15:00:00Z');
// Numeric public facts, reduced from the official feeds checked on2026-11-03. No customerdata.
const nordea=()=>[{rate:'95,200',fundName:'4,00% NORDEA KREDIT SDRO 2059',loanPeriodMax:'30',repaymentFreedomMax:'Nej',isinCode:'DK0002065630'}];
const rd=()=>[{isinCode:'DK0004634938',bondname:'04,00% RD 23S 2059',loanTypeCode:'01',termToMaturityYears:'30.00',nominelInterestRate:'4.0000',numberOfTermsWithoutRepayment:'0',offerprice:94.8853,lastModified:'03-11-2026 15:00:09',prices:[{date:'2026-11-03',price:'94,9500'},{date:'2026-12-30',price:'90,0000'}]}];
const tk=()=>({bondProductsAndPrices:[{isinCode:'DK0009552994',openForLoanOfferFlag:true,lifeCycleStatus:{type:'AVAILABLE'},interestRateInformation:{interestRate:{percentage:4}},characteristics:{loanTenorPeriod:'P30Y',denominationCurrency:'DKK',bondProductPaymentPatternType:{type:'ANNUITY'},preredemptionType:{type:'FULLY_CALLABLE'},bondCouponType:{type:'FIXED_RATE_COUPON_BOND'}},disbursementPriceInformation:{offerPriceWithMarkDown:{value:94.929,dateTime:'2026-11-03T00:00:00'},spotPrice:{value:94.97,dateTime:'2026-11-03T15:28:01'},yieldToMaturity:{percentage:4.5072}}}]});
const feed=async url=>url===MORTGAGE_LENDER_SOURCES.nordea.quotes?nordea():url===MORTGAGE_LENDER_SOURCES.rd.quotes?JSON.stringify(rd()):tk();
test('three matched lenderproducts retain owncoupon,price,bidrag and primarysources',async()=>{
 const c=await getMortgageCatalogue({fetchJson:feed,now});assert.equal(c.offers.length,3);assert.deepEqual(c.coverage.includedLenders,['nordea','rd','totalkredit']);
 const n=c.offers.find(o=>o.lenderId==='nordea'),r=c.offers.find(o=>o.lenderId==='rd'),t=c.offers.find(o=>o.lenderId==='totalkredit');
 assert.equal(n.price,95);assert.equal(n.rawPrice,95.2);assert.equal(r.price,94.95);assert.equal(t.price,94.929);
 assert.deepEqual(n.contribution.tiers.map(x=>x.rate),[.225,.675,1.025]);assert.deepEqual(r.contribution.tiers.map(x=>x.rate),[.206,.618,1.012]);assert.deepEqual(t.contribution.tiers.map(x=>x.rate),[.45,.85,1.2]);
 assert.ok(c.offers.every(o=>o.nominalRate===4&&o.rateKind==='coupon'&&o.productClass==='fixed'&&o.newLoanEligible&&o.termIsMaximum));
 assert.equal(t.effectiveYield,4.5072);assert.notEqual(t.nominalRate,t.effectiveYield);assert.equal(t.priceIncludesSpread,true);
 assert.equal(n.rateObservedAt,null);assert.equal(n.sourceFreshness,'live-retrieval');assert.equal(r.rateObservedAt,'2026-11-03T14:00:09.000Z');assert.equal(c.coverage.excludedLenders[0].id,'jyske');
});
test('closed,interestonly,wrongcurrency,wrongterm and wrongcoupon never match',()=>{
 const n=nordea()[0];for(const patch of [{repaymentFreedomMax:'10'},{loanPeriodMax:'20'},{fundName:n.fundName+' <sup>2)</sup>'},{rate:'101,200'},{fundName:'11,00% NORDEA KREDIT SDRO 2059'}])assert.deepEqual(parseLenderOffers('nordea',[{...n,...patch}],now),[]);
 const r=rd()[0];for(const patch of [{offerprice:-1},{offerprice:100.2},{numberOfTermsWithoutRepayment:'40'},{nominelInterestRate:'11.0'},{loanTypeCode:'09'}])assert.deepEqual(parseLenderOffers('rd',[{...r,...patch}],now),[]);
 for(const mutate of [r=>r.openForLoanOfferFlag=false,r=>r.lifeCycleStatus.type='NO_LONGER_AVAILABLE',r=>r.characteristics.denominationCurrency='EUR',r=>r.characteristics.bondProductPaymentPatternType.type='BULLET',r=>r.interestRateInformation.interestRate.percentage=11]){const data=tk();mutate(data.bondProductsAndPrices[0]);assert.deepEqual(parseLenderOffers('totalkredit',data,now),[]);}
});
test('explicitobservations and sourceprice-reviewexpire failclosed',()=>{
 const stale=rd();stale[0].lastModified='20-10-2026 15:00:00';assert.deepEqual(parseLenderOffers('rd',stale,now),[]);
 const future=rd();future[0].lastModified='04-11-2026 15:00:00';assert.deepEqual(parseLenderOffers('rd',future,now),[]);
 assert.deepEqual(parseLenderOffers('nordea',nordea(),new Date('2026-12-04')),[]);
 const t=tk();t.bondProductsAndPrices[0].disbursementPriceInformation.offerPriceWithMarkDown.dateTime='2026-10-01T00:00:00';assert.deepEqual(parseLenderOffers('totalkredit',t,now),[]);
});
test('missing sources produce coverage reasons ratherthan crosslender substitutions',async()=>{
 const c=await getMortgageCatalogue({fetchJson:async()=>{throw Error('provider blocked')},now});assert.deepEqual(c.offers,[]);assert.equal(c.coverage.excludedLenders.length,4);assert.match(c.coverage.scope,/Helårs/);assert.ok(c.coverage.limitations.some(x=>x.includes('Afdragsfrihed')));
});
test('knownfees are components not fabricated complete switchingcost; discounts expire',()=>{
 const n=parseLenderOffers('nordea',nordea(),now)[0],t=parseLenderOffers('totalkredit',tk(),now)[0];
 assert.equal(n.fees.known,false);assert.equal(n.fees.amount,null);assert.equal(n.fees.components[0].amount,3500);assert.equal(n.fees.effectiveDate,'2026-09-11');assert.ok(n.fees.unknown.length>=3);
 assert.deepEqual(t.contribution.tiers.map(x=>x.interestOnlyRate),[.45,.87,1.85]);assert.equal(t.discounts[0].annualPercentagePoints,.25);assert.equal(t.discounts[0].endsAt,'2029-12-31');assert.equal(t.discounts[0].automaticInComparison,true);assert.equal(t.discounts[0].conditional,false);assert.match(t.discounts[0].sourceUrl,/kundekroner/);
});
test('boundedcache is isolated perfetcher and callers cannot mutate cached sourcefacts',async()=>{
 let calls=0;const fetcher=async url=>{calls++;return feed(url)};
 const first=await getMortgageCatalogue({fetchJson:fetcher,now});first.offers[0].nominalRate=99;first.offers[0].fees.components[0].amount=0;
 const second=await getMortgageCatalogue({fetchJson:fetcher,now:new Date(+now+60000)});assert.equal(calls,3);assert.equal(second.offers[0].nominalRate,4);assert.equal(second.offers[0].fees.components[0].amount,3500);
 await getMortgageCatalogue({fetchJson:fetcher,now:new Date(+now+31*60000)});assert.equal(calls,6);
 assert.equal(parseLenderOffers('nordea',nordea(),now)[0].fees.components[0].amount,3500);
});
test('malformed andemptyproviderobjects never become offers',()=>{
 for(const id of ['nordea','rd','totalkredit'])for(const value of [null,{},'invalid','[]',[]])assert.deepEqual(parseLenderOffers(id,value,now),[]);
});

test('published maximumterm supports chosen21 within conservative10to30comparisonrange',()=>{
 for(const [id,data] of [['nordea',nordea()],['rd',rd()],['totalkredit',tk()]]){
  const o=parseLenderOffers(id,data,now)[0];assert.equal(o.minTermYears,10);assert.equal(o.maxTermYears,30);assert.equal(o.termIsMaximum,true);assert.ok(o.termSourceUrl.startsWith('https://'));assert.ok(o.provenance.some(p=>p.kind==='product-terms'));
 }
});
test('weekendRD prices use latestpublishedpastprice, never a forwarddated settlementprice',()=>{
 const data=rd();data[0].lastModified='06-11-2026 15:00:00';data[0].prices=[{date:'2026-11-06',price:'95,1000'},{date:'2026-11-24',price:'70,0000'}];
 const result=parseLenderOffers('rd',data,new Date('2026-11-07T12:00:00Z'));assert.equal(result.length,1);assert.equal(result[0].price,95.1);
});

test('contact links identify the actual loanproduct and Totalkredit intermediary',()=>{
 const n=parseLenderOffers('nordea',nordea(),now)[0],r=parseLenderOffers('rd',rd(),now)[0],t=parseLenderOffers('totalkredit',tk(),now)[0];
 assert.match(n.contactUrl,/fastforrentet-realkreditlaan/);assert.equal(r.contactUrl,'https://rd.dk/laantyper/obligationslaan');assert.match(t.contactUrl,/lantyper\/fastforrentet/);assert.match(t.contactNote,/samarbejdende pengeinstitutter/);assert.notEqual(n.sourceUrl,n.contactUrl);
});

test('all verified open fixedcoupons keep matchednominal rates ratherthan hardcoded4percent',()=>{
 const n=nordea();n.push({...n[0],isinCode:'DK0002066521',fundName:'3,50% NORDEA KREDIT SDRO 2059',rate:'92,000'});
 const ns=parseLenderOffers('nordea',n,now);assert.deepEqual(ns.map(x=>x.nominalRate),[4,3.5]);assert.equal(ns[1].price,91.8);assert.match(ns[1].product,/3,5 %/);
 const r=rd();r.push({...r[0],isinCode:'DK0004635075',nominelInterestRate:'1.0000',offerprice:65.15,prices:[{date:'2026-11-03',price:'65,1000'}]});
 assert.deepEqual(parseLenderOffers('rd',r,now).map(x=>x.nominalRate),[4,1]);
 const t=tk();const other=structuredClone(t.bondProductsAndPrices[0]);other.isinCode='DK0009556201';other.interestRateInformation.interestRate.percentage=5;other.disbursementPriceInformation.offerPriceWithMarkDown.value=99.2;t.bondProductsAndPrices.push(other);
 const result=parseLenderOffers('totalkredit',t,now);assert.deepEqual(result.map(x=>x.nominalRate),[4,5]);assert.equal(result[1].nominalRate,5);assert.notEqual(result[1].nominalRate,result[1].effectiveYield);
 other.openForLoanOfferFlag=false;assert.equal(parseLenderOffers('totalkredit',t,now).length,1);
});
test('concurrent initialrequests share onlythreefreeofficialfetches and defensivecopies',async()=>{
 let calls=0,release;const wait=new Promise(resolve=>{release=resolve});const fetcher=async url=>{calls++;await wait;return feed(url)};
 const first=getMortgageCatalogue({fetchJson:fetcher,now});const second=getMortgageCatalogue({fetchJson:fetcher,now});assert.equal(calls,3);release();const [a,b]=await Promise.all([first,second]);assert.equal(a.offers.length,3);assert.equal(b.offers.length,3);a.offers[0].nominalRate=77;assert.equal(b.offers[0].nominalRate,4);assert.equal(calls,3);
});
