import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseNykreditCurrentRates,fetchNykreditCurrentRates} from '../mortgage-current-rates.js';
const fixture=fs.readFileSync(new URL('./fixtures/nykredit-current-rates.html',import.meta.url),'utf8');
const now=new Date('2026-11-03T12:00:00Z');
test('actual primary-source fixture parses currentcolumn only and observationdate',()=>{
 const r=parseNykreditCurrentRates(fixture,now);assert.deepEqual([r.F1,r.F3,r.F5,r.fastforrentet],[3.1,3.3,3.4,4.5]);assert.equal(r.observationDate,'2026-10-28');assert.equal(r.fallback,false);assert.equal(r.isLenderQuote,false);assert.equal(r.isIndicative,true);assert.match(r.note,/ikke renteprognoser/);assert.match(r.note,/F1 kan ikke fås som nyt lån/);assert.equal(r.afdragsfri,undefined);
});
test('current header position is respected if columns move, no fixedoffset guess',()=>{
 const moved=fixture.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi,(row,inner)=>{
  const cells=[...inner.matchAll(/<td\b[^>]*>[\s\S]*?<\/td\s*>/gi)].map(m=>m[0]);
  if(cells.length!==6)return row;[cells[1],cells[2]]=[cells[2],cells[1]];return '<tr>'+cells.join('')+'</tr>';
 });
 assert.equal(parseNykreditCurrentRates(moved,now).F5,3.4);
});
test('future forecasts cannot substitute missing current cells or requiredrows',()=>{
 const missingCurrent=fixture.replace(/(<strong>F1<\/strong><\/td>\s*<td[^>]*>)[^<]*/,'$1');assert.throws(()=>parseNykreditCurrentRates(missingCurrent,now));
 assert.throws(()=>parseNykreditCurrentRates(fixture.replace('<strong>F3</strong>','<strong>Differentloan</strong>'),now));
 assert.throws(()=>parseNykreditCurrentRates(fixture.replace('Aktuelt','Forecast'),now));
});
test('missing, future, malformed and stale observationdates failclosed',()=>{
 for(const date of ['','31. februar 2026','28. oktober 2020','28. december 2026'])assert.throws(()=>parseNykreditCurrentRates(fixture.replace('28. oktober 2026',date),now));
 assert.throws(()=>parseNykreditCurrentRates(fixture,new Date('2026-11-13T00:00:00Z')));
});
test('duplicate complete tables do not create ambiguous currentdata',()=>{
 assert.throws(()=>parseNykreditCurrentRates(fixture+fixture.split('</table>')[0]+'</table>',now));
});
test('fetch uses official page, failsclosed onprovidererrors and parses actualHTML',async()=>{
 let url;const r=await fetchNykreditCurrentRates(async(u)=>{url=u;return {ok:true,text:async()=>fixture};},now);assert.equal(url,'https://www.nykredit.dk/dit-liv/bolig/kurser/renteprognose/');assert.equal(r.F1,3.1);
 await assert.rejects(()=>fetchNykreditCurrentRates(async()=>({ok:false,status:503}),now));
});
