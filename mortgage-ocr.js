export class OCRNormalizationError extends Error {
 constructor(message='Ingen brugbare lånetal kunne aflæses. Prøv et tydeligere dokument eller indtast tallene manuelt.') {super(message);this.name='OCRNormalizationError';}
}
function numeric(value,min,max,kind='money') {
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='number'&&typeof value!=='string')return null;
 let n=value;
 if(typeof value==='string'){
  let s=value.trim().replace(/\u00a0|\u202f/g,' ');
  s=s.replace(/^DKK\s*/i,'').replace(/\s*(?:kr\.?|DKK|%|pct\.?|år)\s*$/i,'').trim().replace(/\s/g,'');
  if(!/^[+-]?\d[\d.,]*$/.test(s))return null;
  if(s.includes(',')){
   if(!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(s))return null;
   s=s.replace(/\./g,'').replace(',','.');
  }else if(kind!=='rate'&&/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  else if(!/^[+-]?\d+(?:\.\d+)?$/.test(s))return null;
  n=Number(s);
 }
 return Number.isFinite(n)&&n>=min&&n<=max?n:null;
}
function type(value){
 if(typeof value!=='string'||/[<>]/.test(value))return null;
 const text=value.trim().toLowerCase();
 if(/afdragsfri/.test(text))return 'afdragsfri';
 const flex=text.match(/\bf([135])\b/);if(flex)return 'F'+flex[1];
 if(/^(?:fast|fast rente|fastforrentet)(?: lån)?$/.test(text))return 'fastforrentet';
 return null;
}
function institution(value){
 if(typeof value!=='string'||/[<>\u0000-\u001f]/.test(value))return null;
 const name=value.trim().toLowerCase().replace(/\s+/g,' ');
 const names={'nordea':'Nordea','nordea bank':'Nordea','nordea kredit realkreditaktieselskab':'Nordea','nordea kredit':'Nordea','nordeakredit':'Nordea','nykredit':'Nykredit','nykredit realkredit':'Nykredit','totalkredit':'Totalkredit','realkredit danmark':'Realkredit Danmark','realkredit danmark a/s':'Realkredit Danmark','jyske':'Jyske','jyske bank':'Jyske','jyske realkredit':'Jyske'};
 return names[name]||null;
}
function parse(response){
 if(response&&typeof response==='object'&&!Array.isArray(response)){
  if(response.error||response.type==='error'||['max_tokens','refusal'].includes(response.stop_reason))throw new OCRNormalizationError();
  if(!Object.hasOwn(response,'content'))return response;
  if(!Array.isArray(response.content))throw new OCRNormalizationError();
  response=response.content.filter(c=>c&&c.type==='text'&&typeof c.text==='string').map(c=>c.text).join('\n');
 }
 if(typeof response!=='string'||response.length>100000)throw new OCRNormalizationError();
 let text=response.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
 const first=text.indexOf('{'),last=text.lastIndexOf('}');
 if(first<0||last<first)throw new OCRNormalizationError();
 // Parse one complete object; arrays, truncated objects and multiple outputs are rejected.
 if(text.startsWith('['))throw new OCRNormalizationError();
 text=text.slice(first,last+1);
 try{const result=JSON.parse(text);if(!result||Array.isArray(result)||typeof result!=='object')throw Error();return result;}
 catch{throw new OCRNormalizationError();}
}
export function normalizeClaudeLoanResponse(response){
 const data=parse(response);
 if(data.error||data.type==='error')throw new OCRNormalizationError();
 const restgaeld=numeric(data.restgaeld??data.restgæld,0,100000000);
 const naesteBetaling=numeric(data.naesteBetaling??data.næsteBetaling,0,1000000);
 const periods={'maaned':'maaned','måned':'maaned','månedlig':'maaned','kvartal':'kvartal','kvartalsvis':'kvartal','halvaar':'halvaar','halvår':'halvaar','halvårlig':'halvaar','aar':'aar','år':'aar','årlig':'aar'};
 const betalingsperiode=typeof data.betalingsperiode==='string'?periods[data.betalingsperiode.trim().toLowerCase()]||'ukendt':'ukendt';
 const explicitMonthly=numeric(data.maanedligYdelse??data.currentPayment,0,1000000);
 const divisor={maaned:1,kvartal:3,halvaar:6,aar:12}[betalingsperiode];
 const maanedligYdelse=explicitMonthly??(naesteBetaling!==null&&divisor?naesteBetaling/divisor:null);
 const currentBidrag=numeric(data.currentBidrag??data.bidragssats??data.aarligBidragssats,0,10,'rate');
 const afdragsfriAar=numeric(data.afdragsfriAar,0,30,'years');
 const rawDate=data.refinansiering??data.refinansieringDato??data.refinansieringsdato;
 let refinansiering=null;
 if(typeof rawDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(rawDate)){
  const date=new Date(rawDate);if(Number.isFinite(+date)&&date.toISOString().slice(0,10)===rawDate)refinansiering=rawDate;
 }
 const rente=numeric(data.rente,0,30,'rate');
 const explicitRemaining=data.resterendeLoebetid??data.restloebetid;
 const original=/oprindelig|original/i.test(String(data.loebetidType??data.termType??''));
 const rawTerm=explicitRemaining??(original?null:data.loebetid);
 const term=numeric(rawTerm,1,50,'years'),loebetid=Number.isInteger(term)?term:null;
 const base=type(data.underlyingLaantype)??type(data.laantype);
 const knownInterestOnly=typeof data.afdragsfri==='boolean'?data.afdragsfri:(base==='afdragsfri'||type(data.laantype)==='afdragsfri')?true:null;
 const underlyingLaantype=base&&base!=='afdragsfri'?base:null;
 const laantype=knownInterestOnly===true?'afdragsfri':base;
 const result={restgaeld,maanedligYdelse,rente,loebetid,laantype,afdragsfri:knownInterestOnly,underlyingLaantype,institution:institution(data.institution??data.realkreditinstitut??data.bank),currentBidrag,afdragsfriAar,refinansiering,naesteBetaling,betalingsperiode};
 if(![restgaeld,maanedligYdelse,rente,loebetid,currentBidrag,afdragsfriAar,naesteBetaling].some(value=>value!==null))throw new OCRNormalizationError();
 return result;
}

