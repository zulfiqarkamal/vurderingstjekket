// Shared public-source brief. No AI provider or customer data; at most two linked policy decisions are read.
const DAY=86400000;
export const BRIEF_SOURCES=Object.freeze({
 ecb:{name:'ECB',url:'https://www.ecb.europa.eu/rss/press.html',host:'www.ecb.europa.eu'},
 nationalbanken:{name:'Nationalbanken',url:'https://www.nationalbanken.dk/api/rssfeed?topic=Analyse&lang=da',host:'www.nationalbanken.dk'},
 fed:{name:'Federal Reserve',url:'https://www.federalreserve.gov/feeds/press_monetary.xml',host:'www.federalreserve.gov'},
 usa:{name:'BEA',url:'https://www.bea.gov/news/rss',host:'www.bea.gov'},
 europe:{name:'Eurostat',url:'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/namq_10_gdp?lang=EN&freq=Q&unit=CLV_PCH_PRE&s_adj=SCA&na_item=B1GQ&geo=EA20&sinceTimePeriod=2025-Q1',host:'ec.europa.eu'},
 forecast:{name:'Nykredit',url:'https://www.nykredit.dk/dit-liv/bolig/kurser/renteprognose/',host:'www.nykredit.dk'}
});
const plain=s=>String(s??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const c=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return c>0&&c<=0x10ffff?String.fromCodePoint(c):'';}).replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[x]).replace(/\s+/g,' ').trim();
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(item,tag)=>plain(item.match(new RegExp('<'+tag+'\\b[^>]*>([\\s\\S]*?)<\\/'+tag+'>','i'))?.[1]);
function sourceLink(value,id){try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.hostname!==BRIEF_SOURCES[id].host||u.username||u.password)return null;u.protocol='https:';return u.href;}catch{return null;}}
export function parseBriefFeed(xml,id,now=new Date()){
 if(!BRIEF_SOURCES[id]||typeof xml!=='string'||xml.length>1500000||/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<rss\b/i.test(xml))throw Error('Invalid feed');
 return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0,150).flatMap(m=>{
  const title=field(m[1],'title'),url=sourceLink(field(m[1],'link'),id),raw=field(m[1],'pubDate'),date=Date.parse(raw),age=+new Date(now)-date;
  if(!title||!url||!raw||!Number.isFinite(date)||age<0||age>150*DAY)return [];
  return [{id,url,title:title.slice(0,160),description:field(m[1],'description').slice(0,3500),date:new Date(date).toISOString()}];
 }).sort((a,b)=>b.date.localeCompare(a.date));
}
const months={januar:0,februar:1,marts:2,april:3,maj:4,juni:5,juli:6,august:7,september:8,oktober:9,november:10,december:11};
function danishDate(text,pattern){const m=text.match(pattern);if(!m||months[m[2].toLowerCase()]===undefined)return null;const d=new Date(Date.UTC(+m[3],months[m[2].toLowerCase()],+m[1]));return d.getUTCDate()===+m[1]?d.toISOString():null;}
export function parseBriefForecast(html,now=new Date()){
 if(typeof html!=='string'||html.length>1500000)throw Error('Invalid forecast');
 const text=plain(html),date=danishDate(text,/renteprognose er fra\s+(\d{1,2})\.\s+([a-zæøå]+)\s+(\d{4})/i),observed=danishDate(text,/markedsrenterne er opdateret\s+(\d{1,2})\.\s+([a-zæøå]+)\s+(\d{4})/i);
 if(!date||!observed||+new Date(now)-Date.parse(date)>120*DAY||+new Date(now)<Date.parse(date)||+new Date(now)-Date.parse(observed)>14*DAY||+new Date(now)<Date.parse(observed))throw Error('Stale forecast');
 const candidates=[];
 for(const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
  const rows=[...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>plain(c[1])));
  const header=rows[0]||[],actual=header.indexOf('Aktuelt');if(actual<0)continue;
  const dates=header.flatMap((v,index)=>{const m=v.match(/^(\d{2})-(\d{2})-(\d{2})$/);if(!m)return [];const d=new Date(Date.UTC(2000+(+m[3]),+m[2]-1,+m[1]));return d.getUTCDate()===+m[1]&&+d>+new Date(now)&&+d-+new Date(now)<=366*DAY?[{index,date:d.toISOString()}]:[];});
  const target=dates.sort((a,b)=>b.date.localeCompare(a.date))[0];if(!target)continue;
  const values={};for(const row of rows.slice(1)){const key=/^F[135]$/.test(row[0])?row[0]:/^CITA6\b/.test(row[0])?'CITA6':/^Fast rente 30 år/.test(row[0])?'fixed':null;if(!key)continue;
   const read=v=>/^\d{1,2}(?:[.,]\d{1,3})?%$/.test(v||'')?Number(v.replace('%','').replace(',','.')):null;
   const current=read(row[actual]),expected=read(row[target.index]);if(current!==null&&expected!==null&&current<=30&&expected<=30)values[key]={current,expected};
  }
  if(Object.keys(values).length)candidates.push({date,observed,targetDate:target.date,values});
 }
 if(candidates.length!==1)throw Error('Ambiguous forecast');return candidates[0];
}
export function parseEuropeGrowth(raw,now=new Date()){
 const j=typeof raw==='string'?JSON.parse(raw):raw;
 if(j?.class!=='dataset'||!j.dimension?.time?.category?.index||!Array.isArray(j.size)||j.id?.at(-1)!=='time'||j.size.slice(0,-1).some(n=>n!==1)||j.size.reduce((a,b)=>a*b,1)>1000)throw Error('Invalid GDP dataset');
 for(const [key,wanted]of Object.entries({geo:'EA20',unit:'CLV_PCH_PRE',s_adj:'SCA',na_item:'B1GQ'}))if(j.dimension[key]?.category?.index?.[wanted]!==0||Object.keys(j.dimension[key]?.category?.index||{}).length!==1)throw Error('Wrong GDP scope');
 const updated=Date.parse(j.updated);if(!Number.isFinite(updated)||updated>+new Date(now)||+new Date(now)-updated>150*DAY)throw Error('Stale GDP');
 const entries=Object.entries(j.dimension.time.category.index).filter(([period,index])=>/^\d{4}-Q[1-4]$/.test(period)&&typeof j.value?.[index]==='number').sort((a,b)=>b[0].localeCompare(a[0]));
 if(!entries.length)throw Error('Missing GDP');const [period,index]=entries[0];if(Date.UTC(+period.slice(0,4),(Number(period.slice(-1))-1)*3,1)>+new Date(now))throw Error('Future GDP');return {period,value:j.value[index],previous:entries[1]?j.value[entries[1][1]]:null,updated:new Date(updated).toISOString()};
}
let cached=null,inflight=null;
export async function fetchMarketBrief({fetchText=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/rss+xml,application/xml,application/json,text/html'}});if(!r.ok)throw Error('Source unavailable');const body=await r.text();if(body.length>1500000)throw Error('Oversize');return body;},now=new Date(),cache=true}={}){
 now=new Date(now);if(cache&&cached&&+now>=cached.at&&+now-cached.at<6*3600000)return structuredClone(cached.value);
 if(cache&&inflight)return structuredClone(await inflight);
 const job=(async()=>{const brief={asOf:now.toISOString(),news:[],forecast:null,europe:null,usa:null,unavailable:[]};
 await Promise.all(Object.entries(BRIEF_SOURCES).map(async([id,source])=>{try{const data=await fetchText(source.url);if(id==='forecast')brief.forecast=parseBriefForecast(data,now);else if(id==='europe')brief.europe=parseEuropeGrowth(data,now);else{const items=parseBriefFeed(data,id,now);if(!items.length)throw Error('Empty feed');if(id==='usa'){
  const gdp=items.find(i=>/GDP|gross domestic product/i.test(i.title));if(gdp){const m=gdp.description.match(/real gross domestic product.*?(increased|decreased) at an annual rate of (\d+(?:\.\d+)?) percent/i);brief.usa={title:gdp.title,date:gdp.date,url:gdp.url,value:m?(m[1].toLowerCase()==='decreased'?-1:1)*Number(m[2]):null};}
 }else brief.news.push(...items.filter(i=>/monetary policy decisions|FOMC statement|rente|pengepolitik|inflation|økonom|recession|prognos/i.test(i.title)).slice(0,8));}}catch{brief.unavailable.push(id);}}));
 brief.news.sort((a,b)=>b.date.localeCompare(a.date));
 // RSS policy headlines often omit the decision. Read only the latest official
 // ECB/FED release; if unavailable, retain the dated headline without guessing.
 await Promise.all(['ecb','fed'].map(async id=>{const item=brief.news.find(i=>i.id===id);if(!item)return;try{const body=await fetchText(item.url);if(typeof body!=='string'||body.length>1500000)return;const text=plain(body),decision=text.match(/decided to (?:keep|maintain|lower|cut|raise|increase)[\s\S]{0,700}/i);if(decision)item.description=decision[0];}catch{}}));
 return brief;})();
 if(cache)inflight=job;try{const value=await job;if(cache)cached={at:+now,value};return structuredClone(value);}finally{if(cache)inflight=null;}
}
export function renderMarketBrief(brief,ab={},previous={}){
 const items=[],fmt=n=>Number(n).toLocaleString('da-DK',{maximumFractionDigits:2}),date=s=>new Date(s).toLocaleDateString('da-DK',{timeZone:'Europe/Copenhagen'});
 const add=(title,text,url,sourceDate)=>items.push({title,text,url,sourceDate});
 const f=brief?.forecast;
 if(f){const type=ab.underlyingLaantype||ab.laantype,key=f.values[type]?type:type==='fastforrentet'?'fixed':'CITA6',v=f.values[key];if(v){const label=key==='fixed'?'Effektiv referencerente, fast 30 år':key==='CITA6'?'CITA6 (referencerente for korte lån)':key;
 add('Renteudsigt · prognose',`Nykredit anslår ${label}: ${fmt(v.current)} % aktuelt → ${fmt(v.expected)} % ved ${date(f.targetDate)}. ${previous.forecastDate===f.date&&JSON.stringify(previous.forecastValues)===JSON.stringify(f.values)&&previous.forecastTarget===f.targetDate?'Prognosen er uændret siden din seneste mail. ':''}Det er én udbyders prognose, ikke et lånetilbud eller en sikker renteudvikling.`,BRIEF_SOURCES.forecast.url,f.date);}}
 if(brief?.europe){const g=brief.europe;add('Vækst i euroområdet · faktiske tal',`Euroområdet (20 lande): BNP ${g.period} ${g.value>0?'+':''}${fmt(g.value)} % mod kvartalet før.${g.previous!==null?' Foregående kvartal: '+fmt(g.previous)+' %.':''} ${g.value<0?'Tallene viser tilbagegang i dette kvartal.':'Tallene viser ikke tilbagegang i dette kvartal.'} Ét kvartal er ikke en samlet recessionsvurdering.`,BRIEF_SOURCES.europe.url,g.updated);}
 if(brief?.usa){const g=brief.usa;add('USA · faktiske væksttal',g.value===null?'BEA har offentliggjort nye BNP-oplysninger. Se periode og tal i kilden.':`${g.title}: ${g.value>0?'+':''}${fmt(g.value)} % i annualiseret kvartalsvækst. USA-tallet er opregnet til årstakt og kan ikke sammenlignes direkte med euroområdets kvartalstal.`,g.url,g.date);}
 const cutoff=previous.asOf?Date.parse(previous.asOf):Date.parse(brief?.asOf||'')-35*DAY;
 const news=(brief?.news||[]).filter(i=>Date.parse(i.date)>cutoff&&Date.parse(brief.asOf)-Date.parse(i.date)<=45*DAY);
 // Prefer a policy decision; do not flood a short customer mail with speeches.
 const selected=['ecb','nationalbanken','fed'].map(id=>news.find(i=>i.id===id)).filter(Boolean);
 const policy=i=>{
  const d=i.description;
  if(i.id==='ecb'&&/decided to keep[\s\S]{0,100}interest rates unchanged/i.test(d))return 'ECB fastholder de pengepolitiske renter.';
  if(i.id==='ecb'&&/decided to (?:lower|cut)[\s\S]{0,100}interest rates/i.test(d))return 'ECB sænker de pengepolitiske renter.';
  if(i.id==='ecb'&&/decided to (?:raise|increase)[\s\S]{0,100}interest rates/i.test(d))return 'ECB hæver de pengepolitiske renter.';
  if(i.id==='fed'&&/decided to maintain the target range/i.test(d))return 'FED fastholder sit rentemål.';
  if(i.id==='fed'&&/decided to lower the target range/i.test(d))return 'FED sænker sit rentemål.';
  if(i.id==='fed'&&/decided to raise the target range/i.test(d))return 'FED hæver sit rentemål.';
  if(i.id==='ecb')return 'ECB har offentliggjort sin seneste rentebeslutning. Beslutningens retning kunne ikke bekræftes automatisk; se kilden.';
  if(i.id==='fed')return 'FED har offentliggjort sin seneste rentebeslutning. Beslutningens retning kunne ikke bekræftes automatisk; se kilden.';
  const sentence=i.description.match(/^.{1,250}?[.!?](?:\s|$)/)?.[0]?.trim();
  return i.title+(sentence?' · '+sentence:'');
 };
 for(const item of selected)add('Nyt · '+BRIEF_SOURCES[item.id].name,policy(item)+(item.id==='fed'?' USA kan påvirke globale renter, men FED fastsætter ikke din danske lånerente.':''),item.url,item.date);

 if(!news.length)add('Nyhedskontrol',brief?.unavailable?.some(id=>['ecb','nationalbanken','fed'].includes(id))?'Nogle nyhedskilder kunne ikke kontrolleres. Det er ikke det samme som uændrede renter.':'Ingen nyere relevante centralbanknyheder fundet i de kontrollerede feeds siden sidste kontrol. Renter kan stadig have flyttet sig.');
 if(!brief?.europe||!brief?.usa)add('Væksttal · datastatus','BNP-tal kunne ikke bekræftes for '+[!brief?.europe?'euroområdet':null,!brief?.usa?'USA':null].filter(Boolean).join(' og ')+'. Vi drager ingen konklusion om recession på manglende tal.');
 if(!f)add('Renteudsigt','En tilstrækkeligt aktuel prognose kunne ikke bekræftes. Vi angiver derfor ingen forventet renteændring.');
 const context='For dig som boligejer: Svagere vækst kan dæmpe rentepresset, mens vedvarende inflation kan trække modsat. Danske korte renter er især knyttet til ECB/Nationalbanken. Ingen enkelt nyhed er i sig selv grund til at omlægge.';
 const html='<h2 style="font-size:17px;margin:24px 5px 8px">🌍 Markedet denne måned</h2>'+items.map(i=>'<div style="margin:10px 5px;font-size:13px"><strong>'+escape(i.title)+'</strong><p style="margin:4px 0">'+escape(i.text)+'</p>'+(i.url?'<a style="font-size:12px;color:#52665a" href="'+escape(i.url)+'">Kilde · '+escape(date(i.sourceDate))+'</a>':'')+'</div>').join('')+'<p style="font-size:12px;color:#64766b;margin:12px 5px">'+escape(context)+'</p>';
 return {html,text:['MARKEDET DENNE MÅNED',...items.map(i=>i.title+'\n'+i.text+(i.url?'\nKilde '+date(i.sourceDate)+': '+i.url:'')),context].join('\n\n'),snapshot:{asOf:brief?.asOf||null,forecastDate:f?.date||null,forecastTarget:f?.targetDate||null,forecastValues:f?.values||null}};
}
