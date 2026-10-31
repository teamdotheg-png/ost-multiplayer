'use strict';
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let now=100000,tid=0;const timers=new Map(),events=[],writes=[];let connect;
const app=new Proxy(()=>{}, {get:()=>()=>{}});
const io={on:(event,fn)=>{if(event==='connection')connect=fn;},to:()=>({emit:(event,data)=>events.push({event,data})})};
const context={console,Buffer,URL,AbortSignal,process:{env:{}},setTimeout:(fn,ms)=>{const id=++tid;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),Date:class extends Date{static now(){return now;}},require:name=>{
 if(name==='express'){const f=()=>app;f.static=()=>{};f.json=()=>{};return f;}
 if(name==='http')return {createServer:()=>({listen:()=>{}})};
 if(name==='socket.io')return {Server:function(){return io;}};
 if(name==='./public/hint-reading.js')return require('../public/hint-reading.js');return require(name);
},__dirname:path.resolve(__dirname,'..')};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),context);
context.dbMock=async(table,method,query,body)=>{if(method==='POST')writes.push({table,body});return [];};vm.runInContext('db=dbMock',context);
function tick(ms){const target=now+ms;while(true){const next=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=target;}
function socket(id){const handlers={};const s={id,data:{},on:(e,f)=>handlers[e]=f,join:()=>{},listeners:e=>handlers[e]?[handlers[e]]:[]};connect(s);s.call=async(e,data)=>{let result;await handlers[e](data,x=>result=x);return result;};return s;}
const room=()=>events.filter(x=>x.event==='room').at(-1).data;
const question=(i=0,bonus=true)=>({videoUrl:('abcdefghij'+String(i%10)),answer:'마계천사 지브릴 에피소드3',songName:'Quantum Jump',songAliases:'퀀텀 점프',startTime:0,endTime:60,bonusType:bonus?'text':'none',bonusQuestion:'보호 장치는?',bonusAnswer:'수정',bonusAliases:'크리스털'});
(async()=>{
 const host=socket('host');await host.call('create',{name:'방장',token:'a'.repeat(64)});const code=room().code;
 const guest=socket('guest');await guest.call('join',{code,name:'참가자',token:'b'.repeat(64)});assert.notEqual(room().players[0].color,room().players[1].color);
 assert.notEqual(room().players[0].avatar,room().players[1].avatar);
 const initial=room().players[0];assert.equal((await guest.call('appearance',{avatar:initial.avatar,color:initial.color})).ok,true);assert.equal(room().players[1].avatar,initial.avatar);assert.equal(room().players[1].color,initial.color);
 assert.ok((await guest.call('appearance',{avatar:999,color:'red'})).error);
 const otherHost=socket('other');await otherHost.call('create',{name:'다른방',token:'c'.repeat(64)});const otherCode=room().code;
 for(let i=0;i<15;i++){const x=socket('auto'+i);assert.equal((await x.call('join',{code:otherCode,name:'자동'+i,token:(i+1).toString(16).padStart(64,'0')})).ok,true);}
 assert.equal(new Set(room().players.map(p=>p.avatar)).size,16);assert.equal(new Set(room().players.map(p=>p.color)).size,16);
 await host.call('appearance',{});
 const start=async(qs,testMode=true)=>{const res=await host.call('start',{questions:qs,testMode,shuffle:false,opening:{videoUrl:'abcdefghijk',startTime:20}});assert.equal(res.ok,true);assert.equal(room().phase,'starting');tick(9999);assert.equal(room().phase,'starting');tick(1);assert.equal(room().phase,'ready');assert.equal(room().question,null);assert.ok((await host.call('answer',{stage:1,answer:question().answer})).error);tick(4999);assert.equal(room().phase,'ready');tick(1);assert.equal(room().phase,'playing');assert.equal(room().videoRevealed,false,'Reset video reveal each round');};
 await start([question()],false);assert.equal(writes.length,0,'Starting a question must not save played history');
 assert.ok((await guest.call('revealYoutube',{})).error);assert.equal((await host.call('revealYoutube',{})).ok,true);assert.equal(room().videoRevealed,true);assert.equal(room().firstWinner,null);assert.equal(room().firstAnswer,null);assert.equal(room().bonus,null);assert.equal(room().players.reduce((n,p)=>n+p.score,0),0);assert.equal(writes.length,0);
 await guest.call('chat','퀀텀점프');assert.equal(room().songWinner,'참가자');assert.equal(room().firstWinner,null);assert.equal(writes.length,0,'Song answer must not exclude the track');
 tick(600);await host.call('chat','마계천사지브릴3');assert.equal(room().firstWinner,'방장');assert.equal(writes.length,1);assert.ok(room().bonus);assert.equal(room().completeAt,0);
 tick(600);await guest.call('chat','수정');assert.equal(room().bonusWinner,'참가자');const deadline=room().completeAt;assert.equal(deadline,now+10000);tick(9999);assert.equal(room().phase,'playing');tick(1);assert.equal(room().phase,'finished','Complete must finish directly without reveal delay');
 await host.call('returnLobby',{});await start([question()]);await host.call('answer',{stage:1,answer:'마계천사지브릴3'});await host.call('answer',{stage:2,answer:'수정'});const end=room().completeAt;tick(2000);await guest.call('answer',{stage:3,answer:'Quantum Jump'});assert.equal(room().completeAt,end,'Song answer must not restart countdown');await host.call('togglePause',{});tick(30000);assert.equal(room().phase,'playing');await host.call('togglePause',{});tick(7999);assert.equal(room().phase,'playing');tick(1);assert.equal(room().phase,'finished');
 for(const method of ['hostSkip','skip','timeout']){await host.call('returnLobby',{});await start([question()]);if(method==='skip'){await host.call('skip',{});await guest.call('skip',{});}else if(method==='timeout')tick(60000);else await host.call(method,{});assert.equal(room().phase,'reveal');assert.equal(room().videoRevealed,false);assert.ok((await host.call('revealYoutube',{})).error);tick(5000);assert.equal(room().phase,'finished',method+' last question ending');}
 await host.call('returnLobby',{});await start([question(0,false)]);await host.call('answer',{stage:1,answer:'마계천사지브릴3'});tick(10000);assert.equal(room().phase,'finished','No hidden: title triggers completion');
 await host.call('returnLobby',{});await start(Array.from({length:100},(_,i)=>question(i)));for(let i=0;i<100;i++){assert.equal(room().index,i);await host.call('hostSkip',{});tick(5000);}assert.equal(room().phase,'finished');assert.equal(room().total,100);
 assert.equal(vm.runInContext("matchTitle('마계천사지브릴2',{title:'마계천사 지브릴 에피소드3',aliases:''})",context),false);
 assert.equal(vm.runInContext("matchTitle('게임제목',{title:'게임제목 ~부제~',aliases:''})",context),true);
 assert.equal(vm.runInContext("match('수','수정','')",context),false,'Hidden matching remains exact');
 // Reconnect retains the assigned color and score.
 const before=room().players.find(x=>x.name==='참가자');await guest.call('disconnect');const re=socket('guest-new');await re.call('join',{code,name:'참가자',token:'b'.repeat(64)});const after=room().players.find(x=>x.name==='참가자');assert.equal(after.avatar,before.avatar);assert.equal(after.color,before.color);assert.equal(after.score,before.score);
 console.log('PASS: separate song/title scoring, aliases, solved-only history, 10s intro + 5s game-screen wait, 10s completion, pause, all final paths, 100 rounds, reconnect');
})().catch(e=>{console.error(e);process.exitCode=1;});
