import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildMonitoringEvents,monitoringDate} from '../mortgage-monitoring.js';
const now=new Date('2026-11-03T12:00:00Z');
const ab={restgaeld:2400000,currentPayment:18000,rente:2,loebetid:21,laantype:'fastforrentet',anvKode:'130'};
const market={markedsvaerdi:4700000,kilde:'boligsiden-udbud'};
const row={isComparable:true,goal:'refinance',termYears:21,repayment:'amortizing',monthlyPayment:15000,loanAmount:2400000,initialNetFinancing:2400000,nominalRate:4,productClass:'fixed',providerName:'Testinstitut'};
const comparison=(rows=[row])=>({asOf:now.toISOString(),rankedRows:rows});
const kinds=(loan=ab,m=market,c=comparison(),date=now)=>buildMonitoringEvents(loan,m,c,date).map(event=>event.kind);
test('real dates only; no February rollover or guessed term date',()=>{
 assert.equal(monitoringDate('2027-02-29'),null);assert.equal(monitoringDate('2028-02-29'),'2028-02-29');
 assert.equal(monitoringDate('2027-01-01T00:00:00Z'),null);assert.ok(!kinds().includes('refinancing'));
});
test('120-day refinancing and explicit earlier deadline reminders use bank dates, not assumed two-month rules',()=>{
 const events=buildMonitoringEvents({...ab,refinansiering:'2027-02-01',opsigelsesfrist:'2026-11-30'},market,null,now);
 assert.ok(events.some(e=>e.kind==='refinancing'));const deadline=events.find(e=>e.kind==='deadline');
 assert.equal(deadline.eventDate,'2026-11-30');assert.match(deadline.text,/inden denne dato/);
 assert.match(events.find(e=>e.kind==='refinancing').text,/ikke nødvendigvis/);
 assert.ok(!kinds({...ab,refinansiering:'2027-10-01'}).includes('refinancing'));
});
test('expired dates request updated data only for30days, never roll refinancing forward automatically',()=>{
 const events=buildMonitoringEvents({...ab,refinansiering:'2026-11-01'},market,null,now);
 assert.match(events.find(e=>e.kind==='refinancing').text,/var/);
 assert.ok(!kinds({...ab,refinansiering:'2025-11-01'}).includes('refinancing'));
});
test('interest-only exact end date takes priority; estimated remaining years are anchored once',()=>{
 const loan={...ab,laantype:'afdragsfri',afdragsfriAar:1,loanDataAsOf:'2025-12-01'};
 const event=buildMonitoringEvents(loan,market,null,now).find(e=>e.kind==='interest_only_end');
 assert.equal(event.eventDate,'2026-12-01');assert.equal(event.approximate,true);
 assert.equal(buildMonitoringEvents({...loan,afdragsfriSlut:'2027-01-15'},market,null,now).find(e=>e.kind==='interest_only_end').eventDate,'2027-01-15');
 assert.ok(!kinds({...loan,loanDataAsOf:null,createdAt:null}).includes('interest_only_end'));
});
test('Copenhagen date boundary controls date reminders',()=>{
 const events=buildMonitoringEvents({...ab,opsigelsesfrist:'2026-11-04'},market,null,new Date('2026-11-03T23:30:00Z'));
 assert.equal(events.find(e=>e.kind==='deadline').daysUntil,0);
});
test('lower LTV is a conditional bank-dialogue signal, never an automatic contribution cut',()=>{
 const event=buildMonitoringEvents({...ab,lastMonitoredLtv:65},market,null,now).find(e=>e.kind==='ltv');
 assert.equal(event.threshold,60);assert.match(event.text,/ikke automatisk/);assert.match(event.text,/seneste kontrol/);
 assert.equal(buildMonitoringEvents(ab,{...market,markedsvaerdi:6000000},null,now).find(e=>e.kind==='ltv').threshold,40);
 for(const m of [{...market,kilde:'ev'},{...market,kilde:'unknown'},{...market,markedsvaerdi:3500000}])assert.ok(!kinds(ab,m,null).includes('ltv'));
 assert.ok(!kinds({...ab,anvKode:'510'},market,null).includes('ltv'));
});
test('gross payment signal at3000 does not require complete fees or masquerade as net savings',()=>{
 const event=buildMonitoringEvents(ab,market,comparison(),now).find(e=>e.kind==='payment');
 assert.equal(event.amount,3000);assert.match(event.text,/ikke en dokumenteret nettobesparelse/);
 assert.ok(!kinds(ab,market,comparison([{...row,monthlyPayment:15000.01}])).includes('payment'));
 assert.ok(kinds({...ab,alertYdelseKr:1000},market,comparison()).includes('payment'));
 assert.ok(!kinds({...ab,alertYdelseKr:4000},market,comparison()).includes('payment'));
});
test('no payment signal from longer term, amortization switch, stale source or invalid numbers',()=>{
 for(const patch of [{termYears:30},{repayment:'interestOnly'},{monthlyPayment:null},{monthlyPayment:0},{isComparable:false},{goal:'borrow'}])assert.ok(!kinds(ab,market,comparison([{...row,...patch}])).includes('payment'));
 assert.ok(!kinds({...ab,laantype:'afdragsfri'}).includes('payment'));
 assert.ok(!kinds(ab,market,{...comparison(),asOf:'2026-10-20T00:00:00Z'}).includes('payment'));
});
test('F1/F3/F5 rate rises alone do not fabricate fixed-rate opconversion or debt reduction',()=>{
 for(const laantype of ['F1','F3','F5','afdragsfri']){
  const events=buildMonitoringEvents({...ab,laantype},market,comparison([{...row,loanAmount:2160000,initialNetFinancing:2160000}]),now);
  assert.ok(!events.some(e=>e.kind==='conversion_review'||e.kind==='debt'));
 }
});
test('fixed2to4 without redemption quote gives only general review, never a200k claim',()=>{
 const event=buildMonitoringEvents(ab,market,comparison(),now).find(e=>e.kind==='conversion_review');
 assert.ok(event);assert.equal(event.amount,undefined);assert.match(event.text,/kan ikke opgøre/);
 assert.ok(!kinds(ab).includes('debt'));
});
test('200k gross debt reduction requires fresh explicit redemption price and matching financing basis',()=>{
 const loan={...ab,redemptionPrice:90,redemptionPriceDate:'2026-11-03'};
 const c=comparison([{...row,loanAmount:2200000,initialNetFinancing:2160000}]);
 const event=buildMonitoringEvents(loan,market,c,now).find(e=>e.kind==='debt');assert.equal(event.amount,200000);assert.match(event.text,/før ukendte omkostninger/);assert.match(event.text,/højere rente/);
 for(const patch of [{redemptionPriceDate:null},{redemptionPriceDate:'2026-10-25'},{redemptionPriceDate:'2026-11-04'},{redemptionPrice:null}])assert.ok(!kinds({...loan,...patch},market,c).includes('debt'));
 assert.ok(!kinds(loan,market,comparison([{...row,loanAmount:2200001,initialNetFinancing:2160000}])).includes('debt'));
 assert.ok(!kinds(loan,market,comparison([{...row,loanAmount:2200000,initialNetFinancing:2400000}])).includes('debt'));
});


test('a concrete fresh F3 redemption quote can support a gross debt indication with a tax caveat',()=>{
 const loan={...ab,laantype:'F3',redemptionPrice:90,redemptionPriceDate:'2026-11-03'};
 const events=buildMonitoringEvents(loan,market,comparison([{...row,loanAmount:2200000,initialNetFinancing:2160000}]),now);
 const event=events.find(e=>e.kind==='debt');assert.equal(event.amount,200000);assert.match(event.text,/skattepligtig/);
 assert.ok(!events.some(e=>e.kind==='conversion_review'));
});
