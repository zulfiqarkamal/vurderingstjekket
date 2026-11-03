export const NYKREDIT_CURRENT_RATES_URL='https://www.nykredit.dk/dit-liv/bolig/kurser/renteprognose/';
const text=html=>String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;|&#xA0;/gi,' ').replace(/\s+/g,' ').trim();
const months={januar:0,februar:1,marts:2,april:3,maj:4,juni:5,juli:6,august:7,september:8,oktober:9,november:10,december:11};
export function parseNykreditCurrentRates(html,now=new Date()) {
 if(typeof html!=='string'||html.length>2000000)throw Error('Invalid Nykredit response');
 const body=text(html);
 const dates=[...body.matchAll(/markedsrenterne er opdateret\s+(\d{1,2})\.\s+([a-zæøå]+)\s+(\d{4})/gi)];
 if(dates.length!==1)throw Error('Missing or ambiguous market-rate observation date');
 const [,day,month,year]=dates[0],monthIndex=months[month.toLowerCase()];
 if(monthIndex===undefined)throw Error('Unknown rate observation month');
 const observation=new Date(Date.UTC(Number(year),monthIndex,Number(day)));
 if(observation.getUTCFullYear()!==Number(year)||observation.getUTCMonth()!==monthIndex||observation.getUTCDate()!==Number(day))throw Error('Invalid rate observation date');
 const age=+new Date(now)-+observation;
 if(!Number.isFinite(age)||age<0||age>14*86400000)throw Error('Current reference rates are stale or future dated');
 const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)].map(m=>m[1]);
 const matches=[];
 for(const table of tables){
  const rows=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map(m=>[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map(c=>text(c[1])));
  if(!rows.length)continue;
  const actual=rows[0].findIndex(c=>c==='Aktuelt');if(actual<1)continue;
  const values={};
  for(const row of rows.slice(1)){
   const label=row[0],key=/^F[135]$/.test(label)?label:/^Fast rente 30 år\b/.test(label)?'fastforrentet':null;
   if(!key)continue;
   if(Object.hasOwn(values,key))throw Error('Duplicate current-rate row');
   const cell=row[actual];if(!/^\d{1,2}(?:[,.]\d{1,3})?\s*%$/.test(cell||''))throw Error('Missing current-rate cell');
   const rate=Number(cell.replace('%','').replace(',','.').trim());if(!Number.isFinite(rate)||rate<0||rate>30)throw Error('Invalid current reference rate');
   values[key]=rate;
  }
  if(['F1','F3','F5','fastforrentet'].every(k=>Object.hasOwn(values,k)))matches.push(values);
 }
 if(matches.length!==1)throw Error('No unique complete current-rate table');
 return {...matches[0],source:'Nykredit – aktuelle indikative renter',sourceUrl:NYKREDIT_CURRENT_RATES_URL,
  observationDate:observation.toISOString().slice(0,10),updated:new Date(now).toISOString(),fallback:false,isIndicative:true,isLenderQuote:false,
  note:'Kildens Aktuelt-kolonne, ikke renteprognoser. Indikative referencer, ikke faktiske lånetilbud. F1 kan ikke fås som nyt lån hos kilden, men kun ved profilskifte fra eksisterende F3/F5. Fast rente er effektiv rente på det toneangivende 30-årige lån med afdrag; øvrige løbetider kan afvige. Bidrag og egne vilkår skal bekræftes af banken.'};
}
export async function fetchNykreditCurrentRates(fetchImpl=fetch,now=new Date()) {
 const response=await fetchImpl(NYKREDIT_CURRENT_RATES_URL,{headers:{Accept:'text/html'},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Nykredit current rates HTTP '+response.status);
 return parseNykreditCurrentRates(await response.text(),now);
}
