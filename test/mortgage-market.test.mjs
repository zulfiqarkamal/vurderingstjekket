import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMortgageMarketLookup,mortgageComparables,mortgagePropertyType} from '../mortgage-market.js';
const date=new Date('2026-11-03T12:00:00Z');
const sold=(i,extra={})=>({guid:'s'+i,address:'Demovej '+i,zipCode:9999,price:3000000+i*100000,size:150,sqmPrice:20000+i*1000,soldDate:'2026-06-01',saleType:'Alm. Salg',...extra});
function fixture({sales=[sold(1),sold(2),sold(3)],listings=[],regional=null,failSold=false}={}) {
 const calls=[];
 const lookup=createMortgageMarketLookup({now:()=>date,getCoordinates:async()=>null,distance:()=>0,regionalEstimate:async()=>{calls.push('dst');return regional;},fetchJson:async url=>{
  calls.push(url);if(url.includes('/sold/')){if(failSold)throw Error('blocked');return {results:sales};}return {results:listings};
 }});
 return {lookup,calls};
}
const subject={postnr:'9999',type:'1',anvKode:'120',m2:150};
test('Recent comparable sales take precedence, use median square-metre price and never fetch listings',async()=>{
 const f=fixture();const result=await f.lookup(subject);assert.equal(result.kilde,'boliga');assert.equal(result.markedsvaerdi,3300000);assert.equal(result.compsCount,3);assert.equal(f.calls.length,1);assert.ok(!f.calls[0].includes('2020'));assert.ok(f.calls[0].includes('salesDateMin=2025'));
});
test('Only the last 12 months are accepted, including boundary, excluding future, family and duplicates',()=>{
 const input=[sold(1),sold(2,{soldDate:'2025-11-03T12:00:00Z'}),sold(3,{soldDate:'2025-11-02'}),sold(4,{soldDate:'2027-01-01'}),sold(5,{saleType:'Fam. Salg'}),sold(1),sold(6,{soldDate:'2021-02-01'})];
 const rows=input.map(r=>({...r,squareMeterPrice:r.sqmPrice,salesType:r.saleType}));assert.equal(mortgageComparables(rows,subject,true,date).length,2);
});
test('Current comparable asking prices are used before any reserve when recent sales are absent',async()=>{
 const f=fixture({sales:[],listings:[sold(1),sold(2),sold(3)]});const result=await f.lookup(subject);assert.equal(result.kilde,'boliga-udbud');assert.equal(result.aktiveAnnoncer,3);assert.match(result.note,/udbudspriser/);assert.ok(!f.calls.includes('dst'));
});
test('Sold provider failure still permits the current-listing fallback without a paid scraper',async()=>{
 const f=fixture({failSold:true,listings:[sold(1),sold(2),sold(3)]});assert.equal((await f.lookup(subject)).kilde,'boliga-udbud');assert.ok(f.calls.filter(x=>x!=='dst').every(x=>x.startsWith('https://api.boliga.dk/')));
});
test('When matching sales and listings are absent, neighbourhood sold m² prices scale to subject area',async()=>{
 const f=fixture({sales:[sold(1,{size:250}),sold(2,{size:260}),sold(3,{size:270})]});const result=await f.lookup(subject);assert.equal(result.kilde,'boliga-omraade');assert.equal(result.markedsvaerdi,3300000);assert.match(result.note,/m²/);
});
test('Unsupported distant properties cannot be used as neighbourhood comparisons',()=>{
 const rows=[sold(1),sold(2),sold(3)].map(r=>({...r,squareMeterPrice:r.sqmPrice,latitude:55,longitude:12}));assert.equal(mortgageComparables(rows,{...subject,koord:{},distance:()=>50},true,date).length,0);
});
test('Dissimilar sizes do not become directly comparable sales',async()=>{
 const f=fixture({sales:[sold(1,{size:500}),sold(2,{size:500}),sold(3,{size:500})],listings:[sold(4),sold(5),sold(6)]});assert.equal((await f.lookup(subject)).kilde,'boliga-udbud');
});
test('A genuine EV is used only after all local sold and listing sources fail',async()=>{
 const f=fixture({sales:[]});const result=await f.lookup({...subject,officialEV:4200000});assert.equal(result.kilde,'ev');assert.equal(result.markedsvaerdi,4200000);assert.match(result.note,/handelsprisen kan være højere/);assert.ok(f.calls.some(url=>url.includes('/estate/')));
});
test('No data never falls back to EV or restgæld/65%',async()=>{
 const f=fixture({sales:[]});const result=await f.lookup({...subject,ev:4200000,rest:2400000});assert.equal(result.markedsvaerdi,null);assert.equal(result.kilde,null);
});
test('Shared cache stores upstream rows but different house sizes get their own estimate',async()=>{
 const f=fixture();await f.lookup(subject);const result=await f.lookup({...subject,m2:160});assert.equal(result.markedsvaerdi,3520000);assert.equal(f.calls.length,1);
});
test('Small recent samples still give an estimate with a clear uncertainty note',async()=>{
 const f=fixture({sales:[sold(1)]});const result=await f.lookup({...subject,officialEV:9000000});assert.equal(result.kilde,'boliga');assert.equal(result.markedsvaerdi,3150000);assert.match(result.note,/Lille datagrundlag/);
});
test('Area m² prices can come from asking prices when none of the homes match the subject size',async()=>{
 const f=fixture({sales:[],listings:[sold(1,{size:250}),sold(2,{size:260})]});const result=await f.lookup(subject);assert.equal(result.kilde,'boliga-omraade-udbud');assert.equal(result.aktiveAnnoncer,2);assert.equal(result.compsCount,0);assert.equal(result.markedsvaerdi,3225000);
});

test('Mortgage property categories match actual BBR codes without changing tax helpers',()=>{
 assert.equal(mortgagePropertyType('120'),'1');assert.equal(mortgagePropertyType('130'),'2');assert.equal(mortgagePropertyType('131'),'2');assert.equal(mortgagePropertyType('140'),'3');assert.equal(mortgagePropertyType('510'),'4');assert.equal(mortgagePropertyType('160'),null);
});
test('Listings with an available listing date older than 12 months are not used',()=>{
 const rows=[{...sold(1),squareMeterPrice:21000,listedDate:'2024-01-01'}];assert.equal(mortgageComparables(rows,subject,false,date).length,0);
});
test('Neighbouring postcodes are searched before the EV reserve',async()=>{
 const calls=[];const lookup=createMortgageMarketLookup({now:()=>date,getCoordinates:async()=>null,distance:()=>0,neighbourhoodPostcodes:async()=>['9999','9998'],fetchJson:async url=>{calls.push(url);return {results:url.includes('zipcodeFrom=9998')&&url.includes('/sold/')?[sold(1)]:[]};}});
 const result=await lookup({...subject,officialEV:9000000});assert.equal(result.kilde,'boliga');assert.equal(result.markedsvaerdi,3150000);assert.ok(calls.some(url=>url.includes('9998')));
});

test('Free Boligsiden asking data is used when the direct Boliga API is blocked',async()=>{
 const urls=[];const lookup=createMortgageMarketLookup({now:()=>date,getCoordinates:async()=>null,distance:()=>0,fetchJson:async url=>{
  urls.push(url);if(url.includes('api.boliga.dk'))throw Error('HTTP 403');
  return {totalHits:1,cases:[{caseID:'one',status:'open',addressType:'villa',address:{roadName:'Demovej',houseNumber:'2',zipCode:9999,cityName:'Demoby',livingArea:150},priceCash:3300000,daysListed:{days:10}}]};
 }});const result=await lookup({...subject,officialEV:9000000});assert.equal(result.kilde,'boligsiden-udbud');assert.equal(result.markedsvaerdi,3300000);assert.equal(result.aktiveAnnoncer,1);assert.ok(urls.every(url=>url.startsWith('https://api.boliga.dk/')||url.startsWith('https://api.boligsiden.dk/')));
});
test('Reserve provider rejects wrong postcode, wrong property type and stale listings',async()=>{
 const base={status:'open',addressType:'villa',address:{roadName:'Demo',houseNumber:'1',zipCode:9999,livingArea:150},priceCash:3300000,daysListed:{days:10}};
 const lookup=createMortgageMarketLookup({now:()=>date,getCoordinates:async()=>null,distance:()=>0,fetchJson:async url=>{
  if(url.includes('api.boliga.dk'))throw Error('blocked');return {totalHits:3,cases:[{...base,addressType:'condo'},{...base,address:{...base.address,zipCode:9998}},{...base,daysListed:{days:400}}]};
 }});const result=await lookup({...subject,officialEV:4200000});assert.equal(result.kilde,'ev');assert.equal(result.markedsvaerdi,4200000);
});


test('Nonempty but unusable primary listings do not bypass fresh independent listings',async()=>{
 const urls=[];
 const lookup=createMortgageMarketLookup({now:()=>date,getCoordinates:async()=>null,distance:()=>0,fetchJson:async url=>{
  urls.push(url);
  if(url.includes('/sold/'))return {results:[]};
  if(url.includes('api.boliga.dk'))return {results:[sold(1,{createdDate:'2020-01-01'})]};
  return {totalHits:1,cases:[{caseID:'fresh',status:'open',addressType:'villa',address:{roadName:'Demovej',houseNumber:'20',zipCode:9999,livingArea:150},priceCash:4500000,daysListed:{days:10}}]};
 }});
 const result=await lookup({...subject,officialEV:2000000});
 assert.equal(result.kilde,'boligsiden-udbud');assert.equal(result.markedsvaerdi,4500000);
 assert.equal(result.aktiveAnnoncer,1);assert.ok(urls.some(url=>url.includes('boligsiden')));
 await lookup({...subject,m2:160,officialEV:2000000});
 assert.equal(urls.filter(url=>url.includes('boligsiden')).length,1,'independent source rows are cached');
});
