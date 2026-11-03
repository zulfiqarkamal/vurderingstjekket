import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildMonitoringSnapshot} from '../mortgage-monitoring.js';
const now=new Date('2026-11-03T12:00:00Z');
const loan={restgaeld:2400000,rente:4,loebetid:21,laantype:'afdragsfri',currentPayment:10800,alertYdelseKr:1000};
const rates={F1:3.2,F3:3.5,F5:3.75,fastforrentet:4.5,source:'Danmarks Nationalbank'};
const market={markedsvaerdi:4730572,kilde:'boligsiden-udbud',aktiveAnnoncer:8};

test('Interest-only10800 baseline cannot become a fabricated amortizing saving',()=>{
 const r=buildMonitoringSnapshot(loan,rates,market,now);
 assert.equal(r.currentPayment,10800);assert.equal(r.rateKey,'F3');
 // Independent annuity equation: 252 payments, annual3.5% plus0.55% model contribution.
 const monthly=.0405/12;const expected=Math.round(2400000*monthly/(1-(1+monthly)**-252));
 assert.equal(r.newPayment,expected);assert.equal(r.delta,expected-10800);
 assert.ok(r.delta>0);assert.equal(r.canAlert,false);assert.equal(r.monthlyReduction,0);
 assert.match(r.basisNote,/uden afdrag/);assert.match(r.basisNote,/ikke en ren økonomisk besparelse/);
});

test('Fee, signed change and ceiling break-even follow dashboard assumptions',()=>{
 const r=buildMonitoringSnapshot({...loan,currentPayment:18000,laantype:'F5'},rates,market,now);
 assert.equal(r.fee,27000);assert.equal(r.delta,r.newPayment-18000);
 assert.equal(r.monthlyReduction,18000-r.newPayment);
 assert.equal(r.breakEvenMonths,Math.ceil(27000/r.monthlyReduction));assert.equal(r.canAlert,true);
 assert.equal(r.equity,2330572);assert.equal(r.scenarios.length,4);
});

test('Missing actual payment or property data suppresses action alerts',()=>{
 for(const [ab,m,field] of [[{...loan,currentPayment:null},market,'currentPayment'],[loan,{},'marketValue'],[{...loan,loebetid:null},market,'loebetid']]){
  const r=buildMonitoringSnapshot(ab,rates,m,now);assert.equal(r.canAlert,false);assert.ok(r.missingData.includes(field));
 }
});

test('Fallback or unattributed rates never trigger an action alert',()=>{
 for(const source of ['fallback','',undefined]){
  const r=buildMonitoringSnapshot({...loan,currentPayment:20000},{...rates,source},market,now);
  assert.ok(r.monthlyReduction>0);assert.equal(r.canAlert,false);assert.equal(r.fallbackRates,true);
 }
});

test('Counts and EV reserve are honestly labelled instead of inventing sales',()=>{
 assert.match(buildMonitoringSnapshot(loan,rates,market,now).sourceLabel,/8 aktuelle udbud/);
 assert.match(buildMonitoringSnapshot(loan,rates,market,now).sourceLabel,/ikke gennemførte salg/);
 const sold=buildMonitoringSnapshot(loan,rates,{...market,kilde:'boliga',compsCount:6},now);
 assert.match(sold.sourceLabel,/6 lokale salg.*12 måneder/);
 const ev=buildMonitoringSnapshot(loan,rates,{...market,kilde:'ev'},now);
 assert.match(ev.sourceLabel,/Skats vurdering/);assert.match(ev.sourceLabel,/handelsprisen kan være højere/);
});

test('Configured saving threshold and strict sub60 month cashflow payback both gate alerts',()=>{
 assert.equal(buildMonitoringSnapshot({...loan,currentPayment:18000,alertYdelseKr:10000},rates,market,now).canAlert,false);
 const base=buildMonitoringSnapshot(loan,rates,market,now);
 const r=buildMonitoringSnapshot({...loan,currentPayment:base.newPayment+450,alertYdelseKr:100},rates,market,now);
 assert.equal(r.breakEvenMonths,60);assert.equal(r.canAlert,false);
});

test('Contribution boundaries match40/60/80 and loan debt is not silently projected',()=>{
 for(const [ltv,bidrag] of [[40,.4],[60,.55],[80,.85],[81,1.5]]){
  const r=buildMonitoringSnapshot({...loan,restgaeld:2400000},rates,{...market,markedsvaerdi:2400000/(ltv/100)},now);
  assert.equal(r.bidrag,bidrag);
 }
 const ab={...loan,createdAt:'2020-01-01'};const copy=structuredClone(ab);
 const a=buildMonitoringSnapshot(ab,rates,market,now);
 const b=buildMonitoringSnapshot(ab,rates,market,new Date('2027-11-03'));
 assert.equal(a.newPayment,b.newPayment);assert.deepEqual(ab,copy);assert.match(a.basisNote,/senest oplyste tal/);
});

test('No rate or invalid debt yields missing data without NaN payments',()=>{
 for(const ab of [{...loan,restgaeld:'invalid'},{...loan,restgaeld:-1}]){
  const r=buildMonitoringSnapshot(ab,rates,market,now);assert.equal(r.newPayment,null);assert.equal(r.canAlert,false);assert.ok(r.missingData.includes('restgaeld'));
 }
 const r=buildMonitoringSnapshot(loan,{source:'Danmarks Nationalbank'},market,now);
 assert.equal(r.newPayment,null);assert.ok(r.missingData.includes('rates'));
});

test('F1 remains a conditional reference but never wins new-loan monitoring or alerts',()=>{const r=buildMonitoringSnapshot({...loan,currentPayment:30000},{...rates,F1:0},market,now);assert.equal(r.rateKey,'F3');assert.equal(r.scenarios.find(row=>row.rateKey==='F1').eligibleForNewLoan,false);assert.ok(r.scenarios.find(row=>row.rateKey==='F1').newPayment<r.newPayment);assert.match(r.basisNote,/F1.*eksisterende lån\/profilskifte/);const onlyF1=buildMonitoringSnapshot({...loan,currentPayment:30000},{F1:0,source:'verified'},market,now);assert.equal(onlyF1.newPayment,null);assert.equal(onlyF1.rateKey,null);assert.equal(onlyF1.canAlert,false);assert.ok(onlyF1.missingData.includes('rates'));assert.equal(onlyF1.scenarios.length,1)});
