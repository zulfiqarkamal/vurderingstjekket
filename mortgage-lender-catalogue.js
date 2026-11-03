// Published Danish owner-occupied mortgage data. Never substitutes another lender's rates.
const CHECKED='2026-11-03T00:00:00.000Z',PRICE_REVIEW_EXPIRES='2026-12-03T00:00:00.000Z',QUOTE_TTL=30*60000,MAX_QUOTE_AGE=4*86400000;
export const MORTGAGE_LENDER_SOURCES={
 nordea:{label:'Nordea Kredit',contactUrl:'https://www.nordea.dk/privat/produkter/boliglaan/fastforrentet-realkreditlaan.html',quotes:'https://ebolig.nordea.dk/wemapp/api/credit/fixedrate/bonds.json',page:'https://www.nordea.dk/privat/produkter/boliglaan/Kurser-realkreditlaan-kredit.html',termSourceUrl:'https://www.nordea.dk/privat/produkter/boliglaan/obligationslaan-med-fast-rente.html',contribution:'https://www.nordea.dk/Images/144-119161/20170105bidragssatser.pdf',fees:'https://www.nordea.dk/Images/144-97716/Nordea%20Kredit%20Prisliste%20januar%202025.pdf',effectiveDate:'2026-02-23',feeEffectiveDate:'2026-09-11'},
 rd:{label:'Realkredit Danmark',contactUrl:'https://rd.dk/laantyper/obligationslaan',quotes:'https://rd.dk/api/Rates/GetOpenOffers',page:'https://rd.dk/kurser-og-renter?segment=P',termSourceUrl:'https://rd.dk/laantyper/obligationslaan',contribution:'https://rd.dk/PDF/Privat/Prisblad-privat.pdf',fees:'https://rd.dk/PDF/Privat/Prisblad-privat.pdf',effectiveDate:'2026-09-23',feeEffectiveDate:'2026-09-23'},
 totalkredit:{label:'Totalkredit',contactUrl:'https://www.totalkredit.dk/boliglan/valg-af-lan/lantyper/fastforrentet/',quotes:'https://gateway.api.nykredit.it/mortgage-product-and-price-overview/get-bond-products-and-prices',page:'https://www.totalkredit.dk/boliglan/kurser-og-priser',termSourceUrl:'https://www.totalkredit.dk/boliglan/valg-af-lan/lantyper/fastforrentet/',contribution:'https://www.totalkredit.dk/siteassets/dokumenter/privat/prisblad/prisblad--privat.pdf',fees:'https://www.totalkredit.dk/siteassets/dokumenter/privat/prisblad/prisblad--privat.pdf',effectiveDate:'2026-07-01',feeEffectiveDate:'2026-07-01'},
 jyske:{label:'Jyske Realkredit',quotes:'https://www.jyskebank.dk/bolig/realkreditkurser',page:'https://www.jyskebank.dk/bolig/realkreditkurser',contribution:'https://www.jyskebank.dk/privat/priser/bolig',fees:'https://www.jyskebank.dk/privat/priser/bolig',effectiveDate:'2026-10-01',feeEffectiveDate:'2026-10-01'}
};
const priceLists={
 nordea:{rates:[.225,.675,1.025],io:[.225,.725,1.675],spread:.20,minimumAnnual:null,fees:[{name:'Lånesagsgebyr',kind:'fixed',amount:3500},{name:'Afregningsprovision',kind:'tiered',tiers:[{upTo:200000,percentage:.30,min:175,max:300},{upTo:3000000,percentage:.15,max:3000},{upTo:null,percentage:.10}]}],refinance:{priceDeductionPoints:.30,known:true},discounts:[]},
 rd:{rates:[.206,.618,1.012],io:[.206,.618,1.812],spread:.25,minimumAnnual:null,fees:[{name:'Lånesagsgebyr',kind:'fixed',amount:4000},{name:'Ekspeditionsgebyr af ejendomssag',kind:'fixed',amount:4000},{name:'Afregningsprovision',kind:'percentage',percentage:.15,min:175}],refinance:{priceDeductionPoints:.30,fixedAgreementPoints:.25,known:true},discounts:[]},
 totalkredit:{rates:[.45,.85,1.20],io:[.45,.87,1.85],spread:.20,minimumAnnual:null,fees:[{name:'Lånesagsgebyr',kind:'maximum',amount:4000},{name:'Afregningsprovision',kind:'percentage',percentage:.15,min:150}],refinance:{F1:.30,F3:.20,F5:.20,known:true},discounts:[{name:'KundeKroner',annualPercentagePoints:.25,startsAt:'2025-01-01',endsAt:'2029-12-31',conditional:false,automaticInComparison:true,eligibleCustomerType:'private',sourceUrl:'https://www.totalkredit.dk/boliglan/kurser-og-priser/kundekroner/'}]},
 jyske:{rates:[.225,.8,1],io:[.225,.8,1.62],spread:.20,minimumAnnual:900,fees:[{name:'Bevillingsomkostninger',kind:'fixed',amount:7500},{name:'Afregningsprovision',kind:'percentage',percentage:.15}],refinance:{F1:.30,F3:.20,F5:.20,known:true},discounts:[]}
};
function number(v){if(typeof v!=='number'&&typeof v!=='string')return null;const n=Number(typeof v==='string'?v.replace(',','.'):v);return Number.isFinite(n)?n:null;}
function decoded(data){for(let i=0;i<2&&typeof data==='string';i++){try{data=JSON.parse(data);}catch{return null;}}return data;}
// Official feeds publish local Danish timestamps without an offset.
function danishTime(value){
 if(typeof value!=='string')return null;
 let match=value.match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
 let iso=match?`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]}`:value;
 if(/(?:Z|[+-]\d{2}:\d{2})$/.test(iso)){const n=Date.parse(iso);return Number.isFinite(n)?new Date(n).toISOString():null;}
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(iso))return null;
 const guessed=Date.parse(iso+'Z');if(!Number.isFinite(guessed))return null;
 const offset=new Intl.DateTimeFormat('en',{timeZone:'Europe/Copenhagen',timeZoneName:'shortOffset'}).formatToParts(new Date(guessed)).find(p=>p.type==='timeZoneName')?.value.match(/GMT([+-]\d+)/);
 return offset?new Date(guessed-Number(offset[1])*3600000).toISOString():null;
}
function offer(id,row,now){
 const source=MORTGAGE_LENDER_SOURCES[id],list=priceLists[id],checkedAt=now.toISOString();
 return {id:`${id}-${row.isin}`,lenderId:id,lender:source.label,product:'Fast rente '+row.nominalRate.toLocaleString('da-DK')+' % med afdrag',productClass:'fixed',nominalRate:row.nominalRate,rateKind:'coupon',effectiveYield:row.effectiveYield??null,
  price:row.price,rawPrice:row.rawPrice??row.price,priceIncludesSpread:true,spreadPoints:list.spread,rateIncludesContribution:false,isin:row.isin,
  termYears:30,minTermYears:10,maxTermYears:30,termIsMaximum:true,termSourceUrl:source.termSourceUrl,minimumTermPolicy:'Sammenligningen er afgrænset til 10-30 år; dette er ikke en påstand om instituttets korteste mulige løbetid.',repayment:'amortizing',interestOnlyMaxYears:0,newLoanEligible:true,minLtv:0,maxLtv:80,supportedPropertyTypes:['120','130','131','132','140'],
  contribution:{tiers:[40,60,80].map((upToLtv,i)=>({upToLtv,rate:list.rates[i],interestOnlyRate:list.io[i]})),minimumAnnual:list.minimumAnnual,sourceUrl:source.contribution,effectiveDate:source.effectiveDate,checkedAt:CHECKED,expiresAt:PRICE_REVIEW_EXPIRES},
  fees:{amount:null,known:false,components:structuredClone(list.fees),unknown:['Bankens individuelle gebyrer','Indfrielse af eksisterende lån','Tinglysning og eventuel afgiftsgenbrug'],sourceUrl:source.fees,effectiveDate:source.feeEffectiveDate},
  refinanceRules:structuredClone(list.refinance),discounts:structuredClone(list.discounts),sourceUrl:source.page,dataSourceUrl:source.quotes,contactUrl:source.contactUrl||source.page,contactNote:id==='totalkredit'?'Totalkredit-lån tilbydes gennem samarbejdende pengeinstitutter. Find en bank via produktsiden; Totalkredit er ikke en direkte bankkontakt.':'Kontakt instituttet om et konkret tilbud på det beskrevne lån.',effectiveDate:source.effectiveDate,
  checkedAt,rateObservedAt:row.observedAt??null,rateObservationDateKnown:!!row.observedAt,sourceFreshness:row.observedAt?'published-observation':'live-retrieval',expiresAt:new Date(+now+QUOTE_TTL).toISOString(),expiry:new Date(+now+QUOTE_TTL).toISOString(),priceListExpiresAt:PRICE_REVIEW_EXPIRES,
  isIndicative:true,rankable:true,exclusionReasons:[],notes:[row.note,'Åben fastforrentet serie med afdrag og op til 30 års løbetid. Kuponrenterne kan variere; sammenlign samme provenu, løbetid og gæld efter kurstab. Ikke en afdækning af hele markedet. Bankens vurdering og kreditgodkendelse kræves.','Samlede skifteomkostninger er ukendte; offentliggjorte institutgebyrer er ikke alle kundens omkostninger.'].filter(Boolean),
  provenance:[{kind:'product-terms',url:source.termSourceUrl,checkedAt:CHECKED},{kind:'quote',url:source.quotes,checkedAt,observedAt:row.observedAt??null},{kind:'contribution',url:source.contribution,effectiveDate:source.effectiveDate,checkedAt:CHECKED,expiresAt:PRICE_REVIEW_EXPIRES},{kind:'fees',url:source.fees,effectiveDate:source.feeEffectiveDate,checkedAt:CHECKED,expiresAt:PRICE_REVIEW_EXPIRES}]};
}
function fresh(date,now){return date&&+new Date(date)<=+now+5*60000&&+now-new Date(date)<=MAX_QUOTE_AGE;}
export function parseLenderOffers(lenderId,data,now=new Date()){
 data=decoded(data);now=new Date(now);if(!Number.isFinite(+now)||+now>=Date.parse(PRICE_REVIEW_EXPIRES)||!MORTGAGE_LENDER_SOURCES[lenderId]||+now<Date.parse(MORTGAGE_LENDER_SOURCES[lenderId].feeEffectiveDate))return [];
 const rows=[];
 if(lenderId==='nordea'&&Array.isArray(data))for(const row of data){
  const rawPrice=number(row.rate),name=String(row.fundName||''),coupon=name.match(/^(\d{1,2}[,.]\d{2})% NORDEA KREDIT/i),nominalRate=coupon?number(coupon[1]):null;
  if(number(row.loanPeriodMax)!==30||row.repaymentFreedomMax!=='Nej'||!(nominalRate!==null&&nominalRate>=0&&nominalRate<=10)||/<|>|lukket|closed/i.test(name)||!(rawPrice>50&&rawPrice<=100)||!/^DK\d{10}$/.test(row.isinCode||''))continue;
  rows.push({isin:row.isinCode,nominalRate,rawPrice,price:Math.round((rawPrice-priceLists.nordea.spread)*10000)/10000,note:'Nordea-feedet oplyser ingen observationstid. Hentet live fra et no-store-feed; optagelseskurs reduceres med prislistens 0,20 kurspoint ved udbetaling.'});
 }
 if(lenderId==='rd'&&Array.isArray(data))for(const row of data){
  const nominalRate=number(row.nominelInterestRate),observedAt=danishTime(row.lastModified),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen'}).format(now);
  const priceRow=Array.isArray(row.prices)?row.prices.filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')&&p.date<=today).sort((a,b)=>b.date.localeCompare(a.date))[0]:null;
  const price=number(priceRow?.price),priceDate=priceRow?danishTime(priceRow.date+'T00:00:00'):null;
  if(row.loanTypeCode!=='01'||number(row.termToMaturityYears)!==30||!(nominalRate!==null&&nominalRate>=0&&nominalRate<=10)||number(row.numberOfTermsWithoutRepayment)!==0||!(row.offerprice>0&&row.offerprice<=99.75)||!(price>50&&price<=100)||(!fresh(observedAt,now)||!fresh(priceDate,now))||!/^DK\d{10}$/.test(row.isinCode||''))continue;
  rows.push({isin:row.isinCode,nominalRate,price,observedAt,note:'Aktuel kurs fra instituttets priserække; kursfradraget på 0,25 kurspoint er allerede med og trækkes ikke fra igen.'});
 }
 if(lenderId==='totalkredit'&&Array.isArray(data?.bondProductsAndPrices))for(const row of data.bondProductsAndPrices){
  const nominalRate=number(row.interestRateInformation?.interestRate?.percentage),c=row.characteristics,p=row.disbursementPriceInformation,observedAt=danishTime(p?.offerPriceWithMarkDown?.dateTime),price=number(p?.offerPriceWithMarkDown?.value);
  if(row.openForLoanOfferFlag!==true||row.lifeCycleStatus?.type!=='AVAILABLE'||c?.loanTenorPeriod!=='P30Y'||c?.denominationCurrency!=='DKK'||c?.bondProductPaymentPatternType?.type!=='ANNUITY'||c?.preredemptionType?.type!=='FULLY_CALLABLE'||c?.bondCouponType?.type!=='FIXED_RATE_COUPON_BOND'||!(nominalRate!==null&&nominalRate>=0&&nominalRate<=10)||!(price>50&&price<=99.80)||!fresh(observedAt,now)||!/^DK\d{10}$/.test(row.isinCode||''))continue;
  rows.push({isin:row.isinCode,nominalRate,price,observedAt,effectiveYield:number(p.yieldToMaturity?.percentage),note:'Tilbudskurs med fradrag på 0,20 kurspoint bruges direkte. Effektiv rente fra kilden vises separat og bruges ikke som kuponrente. KundeKroner trækkes automatisk fra private kunders bidrag med 0,25 procentpoint frem til udgangen af 2029; efterfølgende rabat er ikke garanteret.'});
 }
 const unique=new Map();for(const row of rows)unique.set(row.isin,row);
 return [...unique.values()].map(row=>offer(lenderId,row,now));
}
const catalogueCache=new WeakMap(),catalogueInflight=new WeakMap();
const defaultFetchJson=async url=>{const response=await fetch(url,{headers:{Accept:'application/json;v=1'},signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Public source HTTP '+response.status);return response.json();};
export async function getMortgageCatalogue({fetchJson=defaultFetchJson,now=new Date()}={}){
 now=new Date(typeof now==='function'?now():now);if(!Number.isFinite(+now))throw Error('Invalid catalogue time');
 const cached=catalogueCache.get(fetchJson);
 if(cached&&+now-cached.at>=0&&+now-cached.at<QUOTE_TTL)return structuredClone(cached.value);
 if(catalogueInflight.has(fetchJson))return structuredClone(await catalogueInflight.get(fetchJson));
 const job=(async()=>{
 const offers=[],excludedLenders=[];
 await Promise.all(['nordea','rd','totalkredit'].map(async id=>{try{const result=parseLenderOffers(id,await fetchJson(MORTGAGE_LENDER_SOURCES[id].quotes),now);if(result.length)offers.push(...result);else excludedLenders.push({id,lender:MORTGAGE_LENDER_SOURCES[id].label,reason:+now>=Date.parse(PRICE_REVIEW_EXPIRES)?'Prisbladet kræver ny kontrol før brug.':'Ingen frisk, åben og fuldt matchet fastforrentet serie med afdrag fundet.'});}catch{excludedLenders.push({id,lender:MORTGAGE_LENDER_SOURCES[id].label,reason:'Den offentlige kurskilde kunne ikke læses.'});}}));
 excludedLenders.push({id:'jyske',lender:'Jyske Realkredit',reason:'Prisblad og produkter er verificeret, men den offentlige kursoversigt kunne ikke læses pålideligt fra serveren (HTTP 403). Ingen rente eller kurs er erstattet med et andet instituts.'});
 offers.sort((a,b)=>a.lenderId.localeCompare(b.lenderId));
 const result={offers,asOf:now.toISOString(),expiresAt:new Date(+now+QUOTE_TTL).toISOString(),coverage:{scope:'Helårs-ejerboliger, åbne fastforrentede serier med afdrag, 10-30 års valgt løbetid',requestedLenders:4,includedLenders:[...new Set(offers.map(o=>o.lenderId))],excludedLenders,productClasses:['fixed'],limitations:['Ikke hele markedet eller alle kuponer og låntyper.','Ingen bindende tilbud eller garanti for den billigste bank.','Afdragsfrihed, sommerhuse og erhverv er ikke sammenlignet.','Bank-, indfrielses- og tinglysningsomkostninger kræver konkrete tilbud.']}};
 catalogueCache.set(fetchJson,{at:+now,value:structuredClone(result)});return result;
 })();
 catalogueInflight.set(fetchJson,job);
 try{return structuredClone(await job);}finally{if(catalogueInflight.get(fetchJson)===job)catalogueInflight.delete(fetchJson);}
}
