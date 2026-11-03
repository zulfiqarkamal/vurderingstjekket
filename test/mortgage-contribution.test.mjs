import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimateContributionOpportunity,CONTRIBUTION_SOURCES} from '../mortgage-contribution.js';
const base={restgaeld:2400000,value:4730572,anvKode:'130'};
test('known dwellingLTV and debt to60 do not invent currentbidrag',()=>{
 const r=estimateContributionOpportunity(base);assert.equal(r.ltv,2400000/4730572*100);assert.equal(r.thresholdPercent,60);assert.equal(r.debtTo60,0);assert.equal(r.currentBidrag,null);assert.equal(r.actualScenario,null);assert.equal(r.hypothetical,true);assert.ok(r.missingData.includes('currentBidrag'));
 assert.deepEqual(r.illustrations.map(s=>[s.monthly,s.yearly]),[[200,2400],[400,4800],[600,7200]]);assert.ok(r.illustrations.every(s=>s.breakEvenMonths===null));assert.match(r.notes.join(' '),/ikke automatisk/);
});
test('above60 computes actual cash principal needed without assuming contribution repricing',()=>{
 const r=estimateContributionOpportunity({...base,value:3000000});assert.equal(r.ltv,80);assert.equal(r.debtTo60,600000);assert.equal(r.actualScenario,null);
});
test('known current and lower supplied target give exact estimate and costs payback',()=>{
 const r=estimateContributionOpportunity({...base,currentBidrag:.8,targetBidrag:.6,oneOffCosts:5000});
 assert.ok(Math.abs(r.actualScenario.monthly-400)<1e-9);assert.ok(Math.abs(r.actualScenario.yearly-4800)<1e-9);assert.equal(r.actualScenario.breakEvenMonths,13);assert.equal(r.hypothetical,false);assert.match(r.notes.join(' '),/ikke verificeret/);
});
test('currentbidrag caps illustrations; equal or larger target has no actualsaving',()=>{
 for(const targetBidrag of [.15,.2]){
  const r=estimateContributionOpportunity({...base,currentBidrag:.15,targetBidrag});assert.equal(r.actualScenario,null);assert.deepEqual(r.illustrations.map(s=>s.cutPercentagePoints),[.1]);
 }
});
test('summerhomes have no generic60percent target regardless of currentLTV',()=>{
 const r=estimateContributionOpportunity({...base,anvKode:'510'});assert.equal(r.thresholdPercent,null);assert.equal(r.debtTo60,null);assert.match(r.notes.join(' '),/Sommerhuse/);
 assert.equal(estimateContributionOpportunity({...base,anvKode:'999'}).thresholdPercent,null);
});
test('zero debt/currentbidrag/costs are realzero; missing values never turn intozero',()=>{
 const r=estimateContributionOpportunity({...base,restgaeld:0,currentBidrag:0,oneOffCosts:0});assert.equal(r.ltv,0);assert.equal(r.currentBidrag,0);assert.equal(r.oneOffCosts,0);assert.deepEqual(r.illustrations,[]);
 const noDebt=estimateContributionOpportunity({...base,restgaeld:0});assert.ok(noDebt.illustrations.every(s=>s.monthly===0&&s.yearly===0&&s.breakEvenMonths===null));
 const free=estimateContributionOpportunity({...base,oneOffCosts:0});assert.ok(free.illustrations.every(s=>s.breakEvenMonths===0));
 const absent=estimateContributionOpportunity({});assert.equal(absent.ltv,null);assert.equal(absent.restgaeld,null);assert.equal(absent.oneOffCosts,null);assert.equal(absent.debtTo60,null);assert.deepEqual(absent.illustrations,[]);
});
test('invalid amounts or rates never become numeric estimates or NaN',()=>{
 for(const patch of [{restgaeld:true},{restgaeld:-1},{restgaeld:Infinity},{value:0},{value:''},{currentBidrag:'NaN'},{oneOffCosts:[]},{targetBidrag:99}]){
  const r=estimateContributionOpportunity({...base,...patch});assert.doesNotMatch(JSON.stringify(r),/NaN|Infinity/);
 }
 assert.equal(estimateContributionOpportunity({...base,currentBidrag:true}).currentBidrag,null);
});
test('sources are official explanatory references with reviewdate, no lender priceclaim',()=>{
 assert.equal(CONTRIBUTION_SOURCES.length,2);assert.ok(CONTRIBUTION_SOURCES.every(s=>s.url.startsWith('https://')&&s.assessed==='2026-11-03'));assert.ok(Object.isFrozen(CONTRIBUTION_SOURCES));
});

test('decimal rate subtraction does not add a spurious payback month',()=>{
 const r=estimateContributionOpportunity({...base,currentBidrag:.7,targetBidrag:.6,oneOffCosts:4800});
 assert.equal(r.actualScenario.monthly,200);assert.equal(r.actualScenario.breakEvenMonths,24);
});
