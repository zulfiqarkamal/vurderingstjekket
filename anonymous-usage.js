import crypto from 'node:crypto';
import { isIP } from 'node:net';

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Copenhagen', year:'numeric', month:'2-digit', day:'2-digit' });
export const copenhagenDay = instant => {
  const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(instant)).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
export function nextCopenhagenMidnight(instant) {
  const day=copenhagenDay(instant); let low=Number(new Date(instant)), high=low+27*3600000;
  while(low<high){const middle=Math.floor((low+high)/2);if(copenhagenDay(middle)===day)low=middle+1;else high=middle;}
  return low;
}
export function usageClientIP(req, railwayIngress=false) {
  // Railway's public HTTP edge sets X-Real-IP; never trust arbitrary X-Forwarded-For.
  const edge = railwayIngress && req.headers?.['x-forwarded-proto']==='https' ? req.headers?.['x-real-ip'] : null;
  const candidate = typeof edge==='string' && isIP(edge.trim()) ? edge.trim() : req.socket?.remoteAddress;
  if(typeof candidate!=='string'||!isIP(candidate))return 'unknown-peer';
  return candidate.startsWith('::ffff:')&&isIP(candidate.slice(7))===4?candidate.slice(7):candidate.toLowerCase();
}
export function createUsageFileStore(fs,filePath) {
  return {
    load(){return fs.existsSync(filePath)?JSON.parse(fs.readFileSync(filePath,'utf8')):null;},
    save(data){const temporary=filePath+'.tmp';fs.writeFileSync(temporary,JSON.stringify(data),{mode:0o600});fs.renameSync(temporary,filePath);}
  };
}
// Synchronous reserve-before-work prevents concurrent requests racing in one server process.
// Persistent storage must be shared/locked separately before horizontally scaling the app.
export function createDailyUsageLimiter({secret,store,now=()=>Date.now(),railwayIngress=false,limit=5}={}) {
  let state=null, loaded=false;
  const hash = value => crypto.createHmac('sha256',secret).update(value).digest('hex');
  function browser(req,res) {
    const raw=(req.headers?.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith('blr_usage='))?.slice(10);
    const [id,signature]=typeof raw==='string'?raw.split('.'):[];
    if(/^[a-f0-9]{48}$/.test(id||'')&&/^[a-f0-9]{64}$/.test(signature||'')){
      const expected=hash('browser-cookie|'+id);
      if(crypto.timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')))return id;
    }
    const fresh=crypto.randomBytes(24).toString('hex');
    const value=fresh+'.'+hash('browser-cookie|'+fresh);
    if(typeof res.cookie==='function')res.cookie('blr_usage',value,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:31536000000});
    else {const previous=res.getHeader?.('Set-Cookie');const cookie='blr_usage='+value+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000';res.setHeader('Set-Cookie',previous?[...(Array.isArray(previous)?previous:[previous]),cookie]:cookie);}
    return fresh;
  }
  function reserve(kind,req,res) {
    if(!['property','ocr'].includes(kind))throw new Error('Unknown usage bucket');
    if(typeof secret!=='string'||secret.length<8)return {allowed:false,status:503,error:'Gratisopslag er midlertidigt utilgængelige. Prøv igen senere.'};
    try {
      const instant=Number(new Date(now())),day=copenhagenDay(instant),reset=nextCopenhagenMidnight(instant);
      const id=browser(req,res),peer=usageClientIP(req,railwayIngress);
      if(!loaded){state=store.load();loaded=true;}
      if(state && (state.version!==1||typeof state.day!=='string'||!state.counts||typeof state.counts!=='object'||Array.isArray(state.counts)||Object.values(state.counts).some(value=>!Number.isInteger(value)||value<0)))throw Error('Invalid usage storage');
      const current=state?.day===day?state:{version:1,day,counts:{}};
      const keys=[kind+':browser:'+hash(day+'|browser|'+id),kind+':ip:'+hash(day+'|ip|'+peer)];
      const used=Math.max(...keys.map(key=>current.counts[key]||0));
      if(used>=limit)return {allowed:false,status:429,limit,retryAfter:Math.max(1,Math.ceil((reset-instant)/1000)),retryAt:new Date(reset).toISOString(),error:kind==='ocr'?'Du har brugt dagens 5 automatiske dokumentanalyser. Indtast lånetallene manuelt, eller prøv igen i morgen.':'Du har brugt dagens 5 gratis boligopslag. Prøv igen i morgen. Grænsen gælder også din internetforbindelse.'};
      const next={version:1,day,counts:{...current.counts}};
      keys.forEach(key=>{next.counts[key]=(next.counts[key]||0)+1;});
      store.save(next);state=next;
      return {allowed:true,remaining:limit-used-1,limit};
    } catch {return {allowed:false,status:503,error:'Gratisopslag er midlertidigt utilgængelige. Prøv igen senere.'};}
  }
  return {reserve};
}
export function enforceDailyUsage(limiter,kind,req,res) {
  const result=limiter.reserve(kind,req,res);
  if(result.allowed)return true;
  res.setHeader('Cache-Control','no-store');
  if(result.retryAfter)res.setHeader('Retry-After',String(result.retryAfter));
  res.status(result.status).json({error:result.error,...(result.status===429?{code:'DAILY_FREE_LIMIT',limit:result.limit,retryAt:result.retryAt}:{})});
  return false;
}
