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
  const nearTarget=[...dates].sort((a,b)=>a.date.localeCompare(b.date)).find(d=>Date.parse(d.date)-+new Date(now)<=183*DAY);
  const nearValues={},values={};for(const row of rows.slice(1)){const key=/^F[135]$/.test(row[0])?row[0]:/^CITA6\b/.test(row[0])?'CITA6':/^Fast rente 30 år/.test(row[0])?'fixed':null;if(!key)continue;
   const read=v=>/^\d{1,2}(?:[.,]\d{1,3})?%$/.test(v||'')?Number(v.replace('%','').replace(',','.')):null;
   const current=read(row[actual]),expected=read(row[target.index]);if(current!==null&&expected!==null&&current<=30&&expected<=30)values[key]={current,expected};
   const nearExpected=nearTarget?read(row[nearTarget.index]):null;if(current!==null&&nearExpected!==null&&current<=30&&nearExpected<=30)nearValues[key]={current,expected:nearExpected};
  }
  if(Object.keys(values).length)candidates.push({date,observed,targetDate:target.date,values,nearTerm:nearTarget&&Object.keys(nearValues).length?{targetDate:nearTarget.date,values:nearValues}:null});
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
 const rows=[],fmt=n=>Number(n).toLocaleString('da-DK',{maximumFractionDigits:2}),date=s=>new Date(s).toLocaleDateString('da-DK',{timeZone:'Europe/Copenhagen'});
 const link=(name,url,when)=>'<a style="color:#607468;text-decoration:underline" href="'+escape(url)+'">'+escape(name+' '+date(when))+'</a>';
 const add=(icon,title,fact,impact,tone='neutral',sources=[])=>rows.push({icon,title,fact,impact,tone,sources});
 const f=brief?.forecast,view=f?.nearTerm||f,type=ab.underlyingLaantype||ab.laantype,key=view?.values[type]?type:type==='fastforrentet'?'fixed':'CITA6',v=view?.values[key];
 if(v){const delta=v.expected-v.current;
  const unchanged=previous.forecastDate===f.date&&JSON.stringify(previous.forecastValues)===JSON.stringify(view.values)&&previous.forecastTarget===view.targetDate;
  const horizon=date(view.targetDate),shortTerm=!!f.nearTerm;
  const loanLabel=key==='fixed'?'renten på nye faste lån':key==='CITA6'?'den korte referencerente':'renten på '+key+'-lån';
  const reference=key==='fixed'?'Tallet er effektiv rente på nye 30-årige lån.':key==='CITA6'?'CITA6 er en markedsreference, ikke din lånerente.':'Renten tilpasses hvert '+key.slice(1)+'. år på denne lånetype.';
  const impact=delta<0?[key==='fixed'?'Nye faste lån kan blive billigere frem mod '+horizon+'.':'Korte lån kan blive billigere ved rentetilpasning frem mod '+horizon+'.','Billigere finansiering kan støtte efterspørgsel og boligpriser.','Dit lån falder ikke automatisk; bidrag og vilkår tæller også.']:delta>0?[key==='fixed'?'Nye faste lån kan blive dyrere frem mod '+horizon+'.':'Variable låns ydelse kan stige ved rentetilpasning frem mod '+horizon+'.','Dyrere finansiering kan dæmpe efterspørgsel og boligpriser.','Eksisterende fast rente ændres ikke af prognosen.']:['Prognosen peger ikke på billigere renter frem mod '+horizon+'.','Uændrede renter giver ikke i sig selv boligkøbere mere købekraft.','Boligpriser kan stadig ændre sig med indkomster og udbud.'];
  if(delta!==0&&Math.abs(delta)<.25)impact[0]=(delta>0?'En mindre rentestigning':'Et mindre rentefald')+' kan '+(delta>0?'øge':'lette')+(key==='fixed'?' ydelsen på nye faste lån.':' ydelsen på korte lån ved rentetilpasning.');
  if(!shortTerm)impact[0]+=' Der er ingen særskilt korttidsprognose i de viste tal.';
  add(delta<0?'↘':delta>0?'↗':'🔮',shortTerm?'Renteprognose · de kommende måneder':'Renteprognose · frem til '+horizon,['Nykredit forventer '+loanLabel+' '+(delta<0?'lavere':delta>0?'højere':'uændret')+' frem mod '+horizon+'.','Fra '+fmt(v.current)+' % nu til '+fmt(v.expected)+' % i prognosen.',reference+(unchanged?' Uændret siden sidst.':'')],impact,delta<0?'calm':delta>0?'attention':'neutral',[[BRIEF_SOURCES.forecast.name,BRIEF_SOURCES.forecast.url,f.date]]);
 }else add('◌','Renteprognose',['Aktuel prognose kunne ikke bekræftes.','Vi viser ingen udokumenteret retning.','Prøv kilden eller se næste måneds status.'],['Vi angiver ingen forventet renteændring.','Manglende data betyder ikke, at renterne står stille.','Din aktuelle ydelse står i nøgletallene ovenfor.']);
 const cutoff=previous.asOf?Date.parse(previous.asOf):Date.parse(brief?.asOf||'')-35*DAY;
 const news=(brief?.news||[]).filter(i=>Date.parse(i.date)>cutoff&&Date.parse(brief.asOf)-Date.parse(i.date)<=45*DAY);
 const decision=i=>{const d=i?.description||'';if(/decided to (?:keep[\s\S]{0,100}interest rates unchanged|maintain the target range)/i.test(d))return 'fastholder';if(/decided to (?:lower|cut)[\s\S]{0,100}(?:interest rates|the target range)/i.test(d))return 'sænker';if(/decided to (?:raise|increase)[\s\S]{0,100}(?:interest rates|the target range)/i.test(d))return 'hæver';return null;};
 const ecb=news.find(i=>i.id==='ecb'),nb=news.find(i=>i.id==='nationalbanken'),fed=news.find(i=>i.id==='fed'),ecbDirection=decision(ecb),fedDirection=decision(fed);
 const missingNews=!brief||brief.unavailable?.some(id=>['ecb','nationalbanken','fed'].includes(id));
 const nbTopic=nb?(/inflations.?forventninger/i.test(nb.title)?(/husholdningerne[\s\S]{0,180}inflationen[\s\S]{0,100}lavere[\s\S]{0,100}2022/i.test(nb.description)?'NB: husholdninger forventer lavere inflation end toppen i 2022.':'Nationalbanken undersøger husholdningernes inflationsforventninger.'):'Nationalbanken: '+nb.title+'.'):!brief||brief.unavailable?.includes('nationalbanken')?'Nationalbankens analyse kunne ikke kontrolleres.':'Ingen nyere relevant analyse fra Nationalbanken fundet.';
 add('🏦','ECB / Nationalbanken',[ecb?(ecbDirection?'ECB '+ecbDirection+' renten.':'Ny ECB-beslutning; retning ikke bekræftet.'):missingNews?'Nyheder kunne ikke kontrolleres.':'Ingen nyere ECB-beslutning fundet.',nbTopic,'Centralbankerne følger især inflation og økonomisk aktivitet.'],ecbDirection==='sænker'?['Lavere styringsrenter kan lette danske korte lånerenter.','Lavere finansieringsudgifter kan støtte boligefterspørgslen.','Gennemslaget afhænger af dit låns rentetilpasning.']:ecbDirection==='hæver'?['Højere styringsrenter kan presse korte låneydelser op.','Det kan mindske købekraft og dæmpe boligpriser.','Fastforrentede låns aftalte rente ændres ikke.']:[ 'Danske korte renter følger især ECB via Nationalbanken.',ecbDirection==='fastholder'?'Ingen ny ECB-nedsættelse betyder ingen ny lettelse herfra.':'Vi udleder ingen renteændring af manglende nyheder.','Lange renter og boligpriser kan stadig bevæge sig.'],ecbDirection==='hæver'?'attention':'policy',[ecb&&['ECB',ecb.url,ecb.date],nb&&['Nationalbanken',nb.url,nb.date]].filter(Boolean));
 const g=brief?.europe;
 add('📊','Euroområdet · BNP',g?[g.period+': '+(g.value>0?'+':'')+fmt(g.value)+' % fra kvartalet før.','BNP måler den samlede økonomiske aktivitet.',g.previous!==null?'Forrige kvartal: '+fmt(g.previous)+' %.':'Forrige kvartal kunne ikke bekræftes.']:['BNP-tal kunne ikke bekræftes.','Vi kan ikke beskrive udviklingen sikkert.','Se kilden for seneste offentliggørelse.'],g?(g.value<=0?['Svag aktivitet kan dæmpe inflation og rentepres.','Den kan også svække job og efterspørgsel efter boliger.','Lavere renter sikrer derfor ikke højere boligpriser.']:['Vækst kan støtte job, indkomster og efterspørgsel.','Det kan også understøtte det danske boligmarked.','Inflation kan dog holde renterne oppe trods vækst.']):['Ingen konklusion om recession på manglende tal.','Enkeltstående kvartalstal er heller ikke en renteprognose.','Vi afventer bekræftede tal før en vurdering.'],g?.value<0?'attention':'europe',g?[['Eurostat',BRIEF_SOURCES.europe.url,g.updated]]:[]);
 const u=brief?.usa,period=u?.title?.match(/(\d)(?:st|nd|rd|th) Quarter (\d{4})/i);
 add('🌎','USA · BNP / FED',[u?(u.value===null?'BNP-tal: se BEA.':(period?period[2]+'-Q'+period[1]+': ':'')+(u.value>0?'+':'')+fmt(u.value)+' % i annualiseret kvartalsvækst.'):'BNP-tal kunne ikke bekræftes.',fed?(fedDirection?'FED '+fedDirection+' renten.':'Ny FED-beslutning; retning ikke bekræftet.'):!brief||brief.unavailable?.includes('fed')?'FED-nyheder kunne ikke kontrolleres.':'Ingen nyere FED-beslutning fundet.','Årstakt viser kvartalets tempo opregnet til et år.'],(u?.value<0?['Svag amerikansk vækst kan dæmpe globalt rentepres.','Lavere obligationsrenter kan gøre nye faste lån billigere.','Det kan støtte boligkøb; jobusikkerhed kan trække modsat.']:u?.value>0?['Holder væksten inflationen oppe, kan rentefald trække ud.','Globale renter kan smitte af på nye danske faste lån.','Dyrere lån kan dæmpe købekraft og boligpriser.']:['USA påvirker efterspørgsel og renter globalt.','Amerikanske obligationsrenter kan påvirke danske lange renter.','Virkningen på dansk boligkøb er indirekte.']),'usa',[u&&['BEA',u.url,u.date],fed&&['FED',fed.url,fed.date]].filter(Boolean));
 const colors={neutral:'#f2f5f8',calm:'#eaf5ee',attention:'#fff4df',policy:'#eaf5ee',europe:'#f1eef9',usa:'#fff4e6'};
 const lines=value=>(Array.isArray(value)?value:[value]).map(escape).join('<br>');
 const words=value=>Array.isArray(value)?value.join(' '):value;
 const html='<h2 style="font-size:16px;margin:14px 0 7px">🌍 Markedet og din bolig</h2><table aria-label="Nyheder og mulig betydning for danske boligejere" style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px;line-height:1.35"><thead><tr style="background:#194d3b;color:#fff"><th scope="col" style="width:54%;text-align:left;padding:8px">Nyt / prognose</th><th scope="col" style="text-align:left;padding:8px">Mulig betydning for dig</th></tr></thead><tbody>'+rows.map(r=>'<tr><td style="padding:8px;vertical-align:top;border-bottom:3px solid #fff;background:'+colors[r.tone]+';overflow-wrap:anywhere"><strong>'+r.icon+' '+escape(r.title)+'</strong><br>'+lines(r.fact)+(r.sources.length?'<div style="font-size:10px;margin-top:3px">'+r.sources.map(a=>link(...a)).join(' · ')+'</div>':'')+'</td><td style="padding:8px;vertical-align:top;border-bottom:3px solid #fff;background:'+colors[r.tone]+';overflow-wrap:anywhere">'+lines(r.impact)+'</td></tr>').join('')+'</tbody></table><p style="font-size:10px;color:#607468;margin:5px 0">Mulig betydning er vores fortolkning, ikke kildens boligprognose. Renteudsigt: én udbyders prognose, ikke et tilbud. BNP er væksttal, ikke en recessionsprognose; USA er i årstakt, EU pr. kvartal.</p>';
 return {html,text:['MARKEDET OG DIN BOLIG',...rows.map(r=>r.title+': '+words(r.fact)+' → '+words(r.impact)+(r.sources.length?'\n'+r.sources.map(a=>a[0]+' '+date(a[2])+': '+a[1]).join(' · '):'')),'Mulig betydning er vores fortolkning, ikke kildens boligprognose. Renteudsigt: én udbyders prognose, ikke et tilbud. BNP er væksttal; USA i årstakt, EU pr. kvartal.'].join('\n'),snapshot:{asOf:brief?.asOf||null,forecastDate:f?.date||null,forecastTarget:view?.targetDate||null,forecastValues:view?.values||null}};
}
