import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBriefFeed,parseBriefForecast,parseEuropeGrowth,fetchMarketBrief,renderMarketBrief} from '../mortgage-market-brief.js';
const now=new Date('2026-11-03T12:00:00Z');
const rss=(url='https://www.ecb.europa.eu/press/a',date='Fri, 30 Oct 2026 10:00:00 GMT')=>`<rss><channel><item><title>Monetary policy decisions &amp; inflation</title><link>${url}</link><pubDate>${date}</pubDate><description>decided to keep the three key interest rates unchanged</description></item></channel></rss>`;
test('feeds reject foreign links, future/stale releases and XML entities',()=>{
 assert.equal(parseBriefFeed(rss(),'ecb',now).length,1);
 assert.equal(parseBriefFeed(rss('https://evil.example/a'),'ecb',now).length,0);
 assert.equal(parseBriefFeed(rss(undefined,'Wed, 04 Nov 2026 10:00:00 GMT'),'ecb',now).length,0);
 assert.equal(parseBriefFeed(rss(undefined,'Wed, 01 Jan 2025 10:00:00 GMT'),'ecb',now).length,0);
 assert.throws(()=>parseBriefFeed('<!DOCTYPE rss>'+rss(),'ecb',now));
});
const forecast=`<p>renteprognose er fra 14. september 2026. markedsrenterne er opdateret 3. november 2026</p><table><tr><th>Rente</th><th>Aktuelt</th><th>30-09-27</th></tr><tr><td>F3</td><td>3,3%</td><td>2,9%</td></tr></table>`;
test('forecast separates actual rates and dated expectations; rejects stale and ambiguous tables',()=>{
 const f=parseBriefForecast(forecast,now);assert.equal(f.values.F3.current,3.3);assert.equal(f.values.F3.expected,2.9);
 assert.throws(()=>parseBriefForecast(forecast.replace('14. september 2026','14. januar 2026'),now));
 assert.throws(()=>parseBriefForecast(forecast+forecast,now));
});
const gdp={class:'dataset',id:['geo','unit','s_adj','na_item','time'],size:[1,1,1,1,2],updated:'2026-10-30',dimension:Object.fromEntries(Object.entries({geo:'EA20',unit:'CLV_PCH_PRE',s_adj:'SCA',na_item:'B1GQ'}).map(([k,v])=>[k,{category:{index:{[v]:0}}}])),value:{0:0.6,1:0.4}};gdp.dimension.time={category:{index:{'2026-Q2':0,'2026-Q3':1}}};
test('GDP validates region and basis, preserves prior quarter without inventing recession diagnosis',()=>{
 assert.equal(parseEuropeGrowth(gdp,now).previous,.6);
 assert.throws(()=>parseEuropeGrowth({...gdp,updated:'2027-01-01'},now));
 const other=structuredClone(gdp);other.dimension.geo.category.index={DK:0};assert.throws(()=>parseEuropeGrowth(other,now));
});
test('source failures produce honest fallback and do not prevent monthly content',async()=>{
 let calls=0;const brief=await fetchMarketBrief({now,cache:false,fetchText:async()=>{calls++;throw Error('offline');}});
 assert.equal(calls,6);assert.equal(brief.unavailable.length,6);
 const out=renderMarketBrief(brief);assert.match(out.text,/kunne ikke kontrolleres/);assert.match(out.text,/ingen forventet renteændring/);assert.match(out.text,/ingen konklusion om recession/);
});
test('rendering labels unchanged forecasts, skips previously covered news and escapes source text',()=>{
 const f=parseBriefForecast(forecast,now),brief={asOf:now.toISOString(),forecast:f,europe:parseEuropeGrowth(gdp,now),usa:null,news:parseBriefFeed(rss(),'ecb',now),unavailable:[]};
 const first=renderMarketBrief(brief,{laantype:'F3'});assert.match(first.text,/ECB fastholder/);assert.match(first.text,/én udbyders prognose/);
 const next=renderMarketBrief(brief,{laantype:'F3'},first.snapshot);assert.match(next.text,/uændret siden/);assert.doesNotMatch(next.text,/ECB fastholder/);
 brief.news[0].title='<img src=x onerror=alert(1)>';brief.news[0].description='';assert.doesNotMatch(renderMarketBrief(brief).html,/<img/);
});
test('shared fetch cache avoids per-customer source requests',async()=>{
 let calls=0;const options={now:new Date('2031-01-01'),fetchText:async()=>{calls++;throw Error('offline');}};
 await Promise.all([fetchMarketBrief(options),fetchMarketBrief(options)]);await fetchMarketBrief(options);assert.equal(calls,6);
});

test('official policy pages enrich headlines once; unavailable pages keep honest fallback',async()=>{
 let count=0;const b=await fetchMarketBrief({now,cache:false,fetchText:async url=>{count++;if(url.includes('/press/a'))return '<main>The Governing Council decided to lower the three key interest rates by 25 basis points.</main>';if(url.endsWith('press.html'))return rss();throw Error('offline');}});
 assert.equal(count,7);assert.match(renderMarketBrief(b).text,/ECB sænker/);assert.equal(b.unavailable.includes('ecb'),false);
});
