(function(root){
let database={CPU:[],GPU:[]};
const matchCache=new Map();
function norm(s){return String(s||'').toLowerCase().replace(/\(r\)|\(tm\)|\u00ae|\u2122/g,'').replace(/@\s*[\d.]+\s*ghz/g,'').replace(/\b(?:intel|amd|nvidia|geforce|radeon|core|processor|cpu|gpu)\b/g,'').replace(/with radeon.*|with intel.*|radeon graphics.*/g,'').replace(/[^a-z0-9]/g,'');}
function setDatabase(value){database=value||{CPU:[],GPU:[]};matchCache.clear();}
function findModels(text,kind){
 const n=norm(text), rows=database[kind]||[];
 if(!n)return [];
 const exact=rows.filter(x=>norm(x.name)===n);
 if(exact.length===1)return exact.map(x=>({...x,band:x.score}));
 if(exact.length>1)return [];
 // Match complete model names and preserve suffixes (desktop/mobile, Ti, XT, etc.).
 const raw=String(text||'').toLowerCase().replace(/\br([3579])\s+(?=\d{4})/g,'ryzen $1 ').replace(/\(r\)|\(tm\)|\u00ae|\u2122/g,'');
 const found=rows.filter(x=>{
  const name=x.name.toLowerCase().replace(/@.*$/,'').replace(/\b(?:intel|amd|nvidia|geforce|radeon|core|processor|cpu|gpu)\b/g,'').trim();
  const tokens=name.match(/[a-z0-9]+/g)||[];
  if(!tokens.length)return false;
  if(kind==='GPU'&&/mobile|laptop|max.q/i.test(raw)&&!/mobile|laptop|max.q/i.test(name))return false;
  if(tokens.every(t=>/^\d+$/.test(t))&&!/geforce/i.test(raw))return false;
  return new RegExp('(?:^|[^a-z0-9])'+tokens.join('[^a-z0-9]*')+'(?![a-z0-9]|[ -]*(?:ti|super|xt|xtx|x3d|mobile|laptop|max)(?:[^a-z0-9]|$))','i').test(raw);
 }).sort((a,b)=>norm(b.name).length-norm(a.name).length);
 const selected=[];
 for(const x of found){if(!selected.some(y=>norm(y.name).includes(norm(x.name))))selected.push({...x,band:x.score});}
 return selected;
}
function models(text,kind){const key=kind+':'+text;if(!matchCache.has(key))matchCache.set(key,findModels(text,kind));return matchCache.get(key).map(x=>({...x}));}
function fields(text){const out={}; for(const line of String(text||'').split('\n')) {const m=line.match(/^\s*(Processor|Memory|Graphics|Storage|OS|DirectX|Additional Notes)\s*\*?\s*:\s*(.*)/i); if(m)out[m[1].toLowerCase()]=m[2];}return out;}
function gb(s){const m=String(s||'').match(/([\d.]+)\s*(GB|MB)/i);return m?Number(m[1])/(m[2].toUpperCase()==='MB'?1024:1):null;}
function hardware(s,index=0){return {cpu:s?.cpu?.[0]?.Name||'Unknown CPU',gpu:s?.gpus?.[index]?.Name||'Unknown GPU',vram:s?.gpus?.[index]?.vramGB??null,ram:s?.computer?.[0]?.TotalPhysicalMemory?Math.round(s.computer[0].TotalPhysicalMemory/2**30):s?.os?.[0]?.TotalVisibleMemorySize?Math.round(s.os[0].TotalVisibleMemorySize/2**20):null};}
function modelName(name){return name.replace(/^(i[3579]) /,'$1-').replace(/\b(gtx|rtx|rx|gt|ti|xt|xtx|gre|gts|fx)\b/g,s=>s.toUpperCase()).replace(/(\d)([a-z][a-z0-9]*)\b/g,(_,n,s)=>n+s.toUpperCase()).replace(/ryzen/,'Ryzen').replace(/arc/,'Arc').replace(/super/,'SUPER');}
function compare(system,requirements,index=0,baseline='recommended'){
 const hw=hardware(system,index),min=fields(requirements?.minimum),rec=fields(requirements?.recommended);
 const rows=['GPU','CPU','RAM'].map(kind=>{
  const field={GPU:'graphics',CPU:'processor',RAM:'memory'}[kind];
  const fallback=baseline==='recommended'&&!rec[field]&&!!min[field];
  const requirement=(baseline==='minimum'?min[field]:rec[field]||min[field])||'';
  const own=kind==='RAM'?hw.ram:models(hw[kind.toLowerCase()],kind)[0]?.band;
  let reference=null,target=null,requiredVram=null,evidence=null,selectedModel=null;
  if(kind==='RAM'){target=gb(requirement);reference=target===null?null:`${target} GB`}
  else {
   const choices=models(requirement,kind),ownName=norm(hw[kind.toLowerCase()]);
   const sameVendor=choices.filter(m=>kind==='CPU'?ownName.includes('intel')?/^i[3579]/.test(m.name):/ryzen|fx/.test(m.name):/nvidia|geforce/.test(ownName)?/^(gt|rtx|450)/.test(m.name):/radeon/.test(ownName)?/^rx/.test(m.name):/^arc/.test(m.name));
   const sorted=choices.sort((a,b)=>a.band-b.band);
   const ownModel=models(hw[kind.toLowerCase()],kind)[0];
   const fits=m=>{
    if(kind==='CPU'&&ownModel?.single&&m.single&&ownModel.single<m.single*0.95)return false;
    if(own==null||own<m.band)return false;
    if(kind!=='GPU')return true;
    const segment=requirement.split(/\s+or\s+|\/|\|/i).find(p=>models(p,kind).some(x=>x.name===m.name));
    const memory=gb(segment);return memory===null||(hw.vram!==null&&hw.vram>=memory);
   };
   // Meeting any published alternative is sufficient. Never recommend an upgrade
   // just because the same-manufacturer alternative is more demanding.
   const mixed=m=>kind==='CPU'&&ownModel&&(!ownModel.single||!m.single||ownModel.single>=m.single*0.95||ownModel.score>=m.score*0.95);
   const selected=sameVendor.sort((a,b)=>a.band-b.band).find(fits)||sorted.find(fits)||sorted.find(mixed)||sorted[0];
   if(selected){
    selectedModel=selected;reference=selected.name;target=selected.band;evidence=selected.source;
    if(kind==='GPU'){
     const segment=requirement.split(/\s+or\s+|\/|\|/i).find(p=>models(p,kind).some(m=>m.name===selected.name));
     requiredVram=gb(segment);
     if(requiredVram!==null)reference+=' · '+requiredVram+' GB';
    }
   }
  }
  const known=own!=null&&target!=null&&Number.isFinite(own)&&Number.isFinite(target);
  let status=!known?'unknown':kind==='RAM'?(own>target?'above':own<target?'below':'meets'):own>target*1.05?'above':own<target*0.95?'below':'meets';
  const vramBelow=kind==='GPU'&&requiredVram!==null&&hw.vram!==null&&hw.vram<requiredVram;
  const vramUnknown=kind==='GPU'&&requiredVram!==null&&hw.vram===null;
  if(vramBelow)status='below';else if(vramUnknown&&status!=='below')status='unknown';
  let reason=vramBelow?'Insufficient dedicated VRAM':vramUnknown?'Dedicated VRAM not detected':!requirement?'The publisher has not listed this requirement.':own==null?'No matching benchmark result was found.':target==null?'The publisher names a family, not a specific model.':'';
  if(kind==='GPU'&&!selectedModel&&gb(requirement)!==null&&/^(?:\s*\d[\d.]*\s*(?:gb|mb)\s*(?:vram|dedicated|video|graphics|memory|ram|card|with|of|,|\s)*)$/i.test(requirement)){
   requiredVram=gb(requirement);reference=requirement;status=hw.vram==null?'unknown':hw.vram<requiredVram?'below':'meets';
   reason='Checks the published VRAM capacity only; no GPU performance target was supplied.';
  }
  if(kind==='CPU'&&selectedModel){
   const mine=models(hw.cpu,'CPU')[0];
   if(mine&&norm(mine.name)===norm(selectedModel.name))status='meets';
   else if(!mine?.single||!selectedModel.single){status='unknown';reason='Single-thread benchmark unavailable; a reliable CPU comparison needs both scores.';}
   else {
    const ratios=[mine.score/selectedModel.score,mine.single/selectedModel.single];
    status=ratios.every(x=>x>=0.95)?ratios.every(x=>x>1.05)?'above':'meets':ratios.every(x=>x<0.95)?'below':'unknown';
    reason=status==='unknown'?'Mixed benchmark results: single-core and multicore performance differ. No CPU upgrade is confirmed.':'CPU Mark and single-thread comparison; estimated performance, not game FPS.';
   }
  }
  if(kind==='CPU'&&!selectedModel&&requirement){
   const cpu=system?.cpu?.[0], ghz=Number(requirement.match(/([\d.]+)\s*\+?\s*ghz/i)?.[1]);
   const coreText=requirement.match(/(dual|quad|hexa|octa|\d+)\s*[- ]?\s*core/i)?.[1]?.toLowerCase();
   const cores=({dual:2,quad:4,hexa:6,octa:8})[coreText]||Number(coreText)||0;
   const threads=Number(requirement.match(/(\d+)\s*(?:hardware\s+)?(?:cpu\s+)?threads/i)?.[1])||0;
   // Numeric-only publisher requirements are checked literally, never used to rank architectures.
   if((ghz||cores||threads)&&!/(?:i[3579]|ryzen|pentium|athlon|phenom|fx)[ -]?\d/i.test(requirement)){
    const checks=[...(ghz?[cpu?.MaxClockSpeed?cpu.MaxClockSpeed/1000/ghz:null]:[]),...(cores?[cpu?.NumberOfCores?cpu.NumberOfCores/cores:null]:[]),...(threads?[cpu?.NumberOfLogicalProcessors?cpu.NumberOfLogicalProcessors/threads:null]:[])];
    status=checks.some(x=>x===null)?'unknown':checks.some(x=>x<1)?'below':'meets';reference=requirement;
    reason='Checks the stated core/thread count and Windows-reported clock only; not equivalent gaming performance.';
   }else if(/core\s+i[3579]\s*(?:or.*)?$/i.test(requirement)&&new RegExp('core\\s*'+requirement.match(/i[3579]/i)?.[0],'i').test(hw.cpu.replace(/\(TM\)/g,''))){status='meets';reference=requirement;reason='Matches the published CPU family; the publisher gives no model or generation.';}
  }
  return {kind,mine:kind==='RAM'?(hw.ram==null?'Not detected':`${hw.ram} GB`):hw[kind.toLowerCase()]+(kind==='GPU'&&hw.vram!==null?' · '+hw.vram+' GB':''),requirement,reference,target,own,status,fallback,requiredVram,evidence,approximate:kind!=='RAM',label:{above:'Above',meets:'Meets',below:'Below',unknown:!requirement?'Not listed':own==null?'No benchmark':target==null?'Not specific':'Mixed results'}[status],reason};
 });
 const below=rows.filter(r=>r.status==='below'),unknown=rows.filter(r=>r.status==='unknown');
 const status=below.length?'below':unknown.length?'unknown':rows.every(r=>r.status==='above')?'above':'meets';
 return {hw,rows,below,unknown,status,baseline,min,rec,label:{above:'Above requirements',meets:'Meets requirements',below:'Below requirements',unknown:'Unverified'}[status]};
}
function storage(system,requirements,game={},baseline='recommended'){
 const min=fields(requirements?.minimum),rec=fields(requirements?.recommended);
 const text=(baseline==='recommended'?rec.storage||min.storage:min.storage)||'';
 const notes=(baseline==='recommended'?rec['additional notes']||min['additional notes']:min['additional notes'])||'';
 const required=gb(text),ssd=/\bSSD\b|solid.state/i.test(text+' '+notes)&&!/SSD\s+(?:recommended|optional)/i.test(text+' '+notes);
 const drive=system?.disks?.find(d=>d.DeviceID.toLowerCase()===String(game.path||'').slice(0,2).toLowerCase());
 if(!drive)return {status:'unknown',label:'Choose install drive',reason:'Storage depends on the drive where you install the game.',requirement:text};
 if(/\bnvme\b/i.test(text+' '+notes)&&drive.BusType!=='NVMe')return {status:drive.BusType?'below':'unknown',label:drive.BusType?'NVMe drive required':'Drive connection not detected',requirement:text,reason:'The publisher specifies NVMe storage. '+drive.DeviceID+' '+(drive.BusType||'connection type unavailable')};
 const free=drive.FreeSpace/2**30,installed=Number(game.size||0)/2**30;
 const capacity=required===null?(ssd&&drive.MediaType==='SSD'?'SSD requirement met':'Capacity not listed'):free+installed>=required?'Enough capacity':'Free up '+Math.ceil(required-free-installed)+' GB';
 const wrongType=ssd&&drive.MediaType==='HDD';
 return {status:wrongType?'below':required!==null&&free+installed<required?'space':ssd&&!['SSD','HDD'].includes(drive.MediaType)?'unknown':'meets',label:wrongType?'Move to SSD':capacity,requirement:text,reason:drive.DeviceID+' '+(drive.MediaType||'drive type not detected')+' · '+Math.floor(free)+' GB free'+(installed?' · installed files counted toward required capacity':'')+(ssd?' · SSD required':''),upgrade:wrongType&&!system.disks.some(d=>d.MediaType==='SSD'&&d.FreeSpace/2**30>=Math.max(required||0,installed))};
}
const api={compare,hardware,models,fields,gb,setDatabase,storage};if(typeof module!=='undefined')module.exports=api;else root.RadarAnalysis=api;
})(typeof window==='undefined'?globalThis:window);
