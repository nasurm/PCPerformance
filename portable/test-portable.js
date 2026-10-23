const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..','build','Portable test '+Date.now()+' café');
fs.mkdirSync(root,{recursive:true});fs.cpSync(path.resolve(__dirname,'..','build','PC Radar'),root,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const session=path.join(root,'data','runtime.json');
const launch=()=>spawn(path.join(root,'PC Radar.exe'),[],{windowsHide:true,env:{...process.env,RADAR_NO_BROWSER:'1',PATH:process.env.SystemRoot+'\\System32;'+process.env.SystemRoot}});
async function ready(previous){for(let i=0;i<100;i++){try{const d=JSON.parse(fs.readFileSync(session));if(d.instance!==previous){const h=await fetch('http://127.0.0.1:'+d.port+'/api/health').then(r=>r.json());if(h.instance===d.instance)return d;}}catch{}await wait(200)}throw Error('Portable launch timed out')}
async function stop(d){const url='http://127.0.0.1:'+d.port;const b=await fetch(url+'/api/bootstrap').then(r=>r.json());const r=await fetch(url+'/api/exit',{method:'POST',headers:{'X-Radar-Token':b.token}});assert.equal(r.status,200);await wait(500);await assert.rejects(fetch(url+'/api/health'));}
(async()=>{
 const first=launch();const a=await ready();assert.equal(first.exitCode,null);console.log('PASS executable launches from a path with spaces and Unicode, without Node on PATH');
 const second=launch();await new Promise(resolve=>second.on('exit',resolve));assert.equal(second.exitCode,0);assert.equal(JSON.parse(fs.readFileSync(session)).instance,a.instance);console.log('PASS duplicate launch reuses existing instance');
 const url='http://127.0.0.1:'+a.port;
 const b=await fetch(url+'/api/bootstrap').then(r=>r.json());assert.equal(b.portable,true);assert.deepEqual(b.config,{roots:[],manual:[]});assert.equal(b.dataDir,path.join(root,'data'));
 assert.equal((await fetch(url+'/api/exit',{method:'POST'})).status,403);
 const s=await fetch(url+'/api/system').then(r=>r.json());assert.ok(s.cpu?.length);assert.ok(s.disks?.length);console.log('PASS actual Windows hardware scan and protected Exit');
 await stop(a);console.log('PASS Exit stops server');
 const blocker=net.createServer();await new Promise(r=>blocker.listen(a.port,'127.0.0.1',r));
 const third=launch();const c=await ready(a.instance);assert.notEqual(c.port,a.port);console.log('PASS occupied port selects another available port');
 await stop(c);await new Promise(r=>blocker.close(r));
 console.log('Test copy: '+root);
})().catch(e=>{console.error(e);process.exitCode=1});
