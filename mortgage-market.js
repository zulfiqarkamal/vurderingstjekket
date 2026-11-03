// Current mortgage estimates are deliberately separate from the 2022 tax-appeal model.
// Only free public endpoints are used here; there is no paid scraper fallback.
const median = values => {
  const a = [...values].sort((x, y) => x - y), n = a.length;
  return n ? (a[Math.floor((n - 1) / 2)] + a[Math.floor(n / 2)]) / 2 : null;
};
const normalAddress = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
export function mortgagePropertyType(code) {
  const n=Number(code);
  if([130,131,132,122].includes(n))return '2';
  if(n===140)return '3';
  if(n===510)return '4';
  if([110,120,121].includes(n))return '1';
  return null;
}
export function mortgageComparables(rows, subject, sold, now = new Date()) {
  const earliest = new Date(now); earliest.setFullYear(earliest.getFullYear() - 1); earliest.setUTCHours(0,0,0,0);
  const unique = new Set();
  let pool = rows.filter(row => {
    const key = row.guid || `${row.address}|${row.price}|${row.soldDate || ''}`;
    if (unique.has(key)) return false;
    unique.add(key);
    const date = new Date(row.soldDate), listed = row.listedDate ? new Date(row.listedDate) : null;
    return row.size > 0 && row.price > 0 && row.squareMeterPrice > 5000 && row.squareMeterPrice < 150000 &&
      (subject.relaxSize || (row.size >= subject.m2 * .6 && row.size <= subject.m2 * 1.4)) &&
      (!subject.address || normalAddress(row.address) !== normalAddress(subject.address)) &&
      (!listed || (!Number.isFinite(+listed) || (listed >= earliest && listed <= now))) &&
      (!sold || (!/fam|auktion|tvang/i.test(String(row.salesType || '')) &&
        Number.isFinite(+date) && date >= earliest && date <= now));
  });
  const closeSize = pool.filter(row => row.size >= subject.m2 * .75 && row.size <= subject.m2 * 1.25);
  if (!subject.relaxSize && closeSize.length >= 3) pool = closeSize;
  if (subject.year > 1700) {
    const sameEra = pool.filter(row => row.buildYear && Math.abs(row.buildYear - subject.year) <= 25);
    if (sameEra.length >= 3) pool = sameEra;
  }
  if (subject.koord) {
    // getAdresseKoordinater supplies UTM. Conversion stays with the existing server helper.
    pool = pool.filter(row => Number.isFinite(+row.latitude) && Number.isFinite(+row.longitude) && +row.latitude && +row.longitude)
      .map(row => ({...row, distance: subject.distance(row, subject.koord)}))
      .filter(row => row.distance <= 5);
    for (const radius of [1, 2, 5]) {
      const nearby = pool.filter(row => row.distance <= radius);
      if (nearby.length >= 3) { pool = nearby; break; }
    }
  }
  return pool;
}
export function createMortgageMarketLookup({fetchJson, getCoordinates, distance, neighbourhoodPostcodes = async input => [input.postnr], now = () => new Date()}) {
  const cache = new Map(), inflight = new Map();
  async function boligsidenListings(zip,type) {
    const propertyType={'1':'villa','2':'terraced house','3':'condo','4':'holiday house'}[type];
    if(!propertyType)return [];
    const rows=[];
    for(let page=1;page<=2;page++) {
      const params=new URLSearchParams({zipCodes:zip,addressTypes:propertyType,per_page:'100',page:String(page),sortBy:'daysListed',sortAscending:'true'});
      const data=await fetchJson('https://api.boligsiden.dk/search/cases?'+params);
      if(!Array.isArray(data.cases))throw new Error('Uventet Boligsiden-svar');
      for(const item of data.cases) {
        const a=item.address||{},area=+(item.housingArea||a.livingArea),price=+item.priceCash,days=Number(item.daysListed?.days);
        if(String(a.zipCode)!==String(zip) || (item.addressType||a.addressType)!==propertyType || item.status!=='open' || !(area>0) || !(price>0))continue;
        rows.push({guid:item.caseID,address:`${a.roadName||a.road?.name||''} ${a.houseNumber||''}, ${a.zipCode} ${a.cityName||a.city?.name||''}`,
          price,size:area,squareMeterPrice:price/area,buildYear:+item.yearBuilt,provider:'boligsiden',
          latitude:item.coordinates?.lat||a.coordinates?.lat,longitude:item.coordinates?.lon||a.coordinates?.lon,
          listedDate:Number.isFinite(days)?new Date(+now()-days*86400000).toISOString():null});
      }
      if(page*100>=Number(data.totalHits||0))break;
    }
    return rows;
  }
  async function boliga(zip, type, sold) {
    const key = `${zip}|${type}|${sold}`, cached = cache.get(key);
    if (cached && +now() - cached.at < 2*3600000) return cached.rows;
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      const rows = [];
      try {
      for (let page = 1; page <= 2; page++) {
        const params = new URLSearchParams({searchTab:'1',propertyType:type,zipcodeFrom:zip,zipcodeTo:zip,sort:'date-d',pageSize:'50',page:String(page)});
        if (sold) { params.set('salesDateMin', String(now().getFullYear()-1)); params.set('salesDateMax', String(now().getFullYear())); }
        const data = await fetchJson(`https://api.boliga.dk/api/v2/${sold?'sold':'estate'}/search/results?${params}`);
        if (!Array.isArray(data.results)) throw new Error('Uventet Boliga-svar');
        rows.push(...data.results);
        if (page >= (data.meta?.totalPages || 1)) break;
      }
      } catch(error) {
        if(sold)throw error;
        const alternate=await boligsidenListings(zip,type);
        cache.set(key,{rows:alternate,at:+now()});return alternate;
      }
      if(!sold && !rows.length) {
        const alternate=await boligsidenListings(zip,type);
        cache.set(key,{rows:alternate,at:+now()});return alternate;
      }
      const normalized = rows.map(row => ({
        guid:row.guid || row.id, address:`${row.address || ''}, ${row.zipCode || zip} ${row.city || ''}`.trim(),
        price:+row.price, size:+row.size, squareMeterPrice:+row.sqmPrice || (+row.price / +row.size),
        soldDate:row.soldDate, listedDate:row.createdDate || row.addedDate || row.listDate, buildYear:+row.buildYear, salesType:row.saleType,
        latitude:row.latitude, longitude:row.longitude,
      }));
      cache.set(key, {rows:normalized,at:+now()});
      return normalized;
    })();
    inflight.set(key,job);
    try { return await job; } finally { inflight.delete(key); }
  }
  return async function mortgageMarket(input) {
    const koord = input.adresseId ? await getCoordinates(input.adresseId).catch(()=>null) : null;
    const subject = {...input,koord,distance};
    let sales = [], listings = [], rawSales = [], rawListings = [], soldUnavailable = false;
    try { rawSales = [...await boliga(input.postnr,input.type,true)];sales = mortgageComparables(rawSales,subject,true,now()); }
    catch (_) { soldUnavailable = true; }
    function estimate(rows,kilde) {
      const amount = Math.round(median(rows.map(row=>row.squareMeterPrice))*input.m2);
      const asking=kilde==='boliga-udbud'||kilde==='boliga-omraade-udbud';
      const actualSource=asking && rows.every(row=>row.provider==='boligsiden') ? kilde.replace('boliga','boligsiden') : kilde;
      return {markedsvaerdi:amount,kilde:actualSource,compsCount:asking?0:rows.length,
        aktiveAnnoncer:asking?rows.length:0,
        sammenligninger:rows.slice(0,8).map(row=>({adresse:row.address,dato:asking?'':String(row.soldDate).slice(0,10),pris:row.price,m2:row.size})),
        handler:asking?[]:rows.slice(0,8).map(row=>({adresse:row.address,dato:String(row.soldDate).slice(0,10),pris:row.price,m2:row.size})),
        periode:asking?'Aktuelle udbud':'Seneste 12 måneder',omraade:koord?'Inden for 5 km':'Samme postnummer',
        note:[kilde==='boliga-udbud'||kilde==='boliga-omraade-udbud'?'Baseret på aktuelle udbudspriser, ikke gennemførte salg.':kilde==='boliga-omraade'?'Lokale salgspriser pr. m² × boligens areal. Størrelserne er mindre direkte sammenlignelige.':null,rows.length<3?'Lille datagrundlag; estimatet er ekstra usikkert.':null].filter(Boolean).join(' ')||null};
    }
    if (sales.length) return estimate(sales,'boliga');
    try { rawListings=[...await boliga(input.postnr,input.type,false)];listings = mortgageComparables(rawListings,subject,false,now()); }
    catch (_) { /* Continue with local square-metre prices or the explicit EV reserve. */ }
    if (listings.length) return estimate(listings,'boliga-udbud');
    const areaSales=mortgageComparables(rawSales,{...subject,relaxSize:true},true,now());
    if (areaSales.length>=3) return estimate(areaSales,'boliga-omraade');
    const nearby=await neighbourhoodPostcodes({...input,koord}).catch(()=>[]);
    await Promise.all(nearby.filter(zip=>zip!==input.postnr).slice(0,4).map(async zip=>{
      const result=await Promise.allSettled([boliga(zip,input.type,true),boliga(zip,input.type,false)]);
      if(result[0].status==='fulfilled')rawSales.push(...result[0].value);
      if(result[1].status==='fulfilled')rawListings.push(...result[1].value);
    }));
    sales=mortgageComparables(rawSales,subject,true,now());
    listings=mortgageComparables(rawListings,subject,false,now());
    if(sales.length>=3)return estimate(sales,'boliga');
    if(listings.length>=3)return estimate(listings,'boliga-udbud');
    const neighbourhoodSales=mortgageComparables(rawSales,{...subject,relaxSize:true},true,now());
    const neighbourhoodListings=mortgageComparables(rawListings,{...subject,relaxSize:true},false,now());
    // A small real sample is still preferable to silently substituting a tax assessment.
    if(sales.length)return estimate(sales,'boliga');
    if(listings.length)return estimate(listings,'boliga-udbud');
    if(neighbourhoodSales.length)return estimate(neighbourhoodSales,'boliga-omraade');
    if(neighbourhoodListings.length)return estimate(neighbourhoodListings,'boliga-omraade-udbud');
    if(input.officialEV>=100000 && input.officialEV<=50000000) return {markedsvaerdi:input.officialEV,kilde:'ev',compsCount:0,aktiveAnnoncer:0,handler:[],sammenligninger:[],
      note:`Skats vurdering — handelsprisen kan være højere. ${soldUnavailable?'Markedsdata kunne ikke hentes.':'Ingen brugbare nyere lokale salg eller aktuelle udbud fundet.'}`};
    return {markedsvaerdi:null,kilde:null,compsCount:sales.length,aktiveAnnoncer:listings.length,handler:[],
      reason:soldUnavailable?'Markedsdata er midlertidigt utilgængelige. Oplys EV som reserve.':'Ingen nyere lokale salg eller aktuelle udbud fundet. Oplys EV som reserve.'};
  };
}
