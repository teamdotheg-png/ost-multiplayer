'use strict';
const express = require('express');
const http = require('http');
const {Server} = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const app = express();
const server = http.createServer(app);
const io = new Server(server,{maxHttpBufferSize:1e6});
app.use(express.static(path.join(__dirname,'public')));
const rooms = new Map();
const HINT_AT = 15000, REVEAL_DELAY = 5000, COMPLETE_SKIP_DELAY = 2000;
const norm = s => String(s??'').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const match = (input,main,aliases='') => {
  const a=norm(input); return !!a && [main,...String(aliases).split(',')].some(x=>norm(x)===a);
};
const sanitize = (s,n=100) => String(s??'').trim().slice(0,n);
const getRoom = socket => rooms.get(socket.data.room);
const memberList = r => [...r.players.values()].map(p=>({id:p.id,name:p.name,score:p.score,host:p.id===r.host}));
const safeQuestion = q => ({videoId:q.videoId,start:q.start,end:q.end,hasBonus:q.bonus.type!=='none',bonusType:q.bonus.type});
const emitRoom = r => {
  const current = r.index>=0 && r.index<r.questions.length ? r.questions[r.index] : null;
  io.to(r.code).emit('room',{
  code:r.code,phase:r.phase,host:r.host,players:memberList(r),total:r.questions.length,
  index:r.index,skipVotes:r.votes.size,skipNeeded:Math.floor(r.players.size/2)+1,
  firstWinner:r.firstWinner,bonusWinner:r.bonusWinner,
  firstAnswer:current&&r.firstWinner?current.title:null,
  bonusAnswer:current&&r.bonusWinner?(current.bonus.type==='multiple'?current.bonus.choices[current.bonus.correct]:current.bonus.answer):null,
  deadline:r.deadline,hintAt:r.hintAt,revealUntil:r.revealUntil||0,paused:!!r.paused,pauseRemaining:r.pauseRemaining||0,pauseHintRemaining:r.pauseHintRemaining||0,pauseRevealRemaining:r.pauseRevealRemaining||0,
  question:['playing','complete-wait'].includes(r.phase)&&current?safeQuestion(current):null,
  bonus:['playing','complete-wait'].includes(r.phase)&&current&&r.firstWinner&&current.bonus.type!=='none'?
    publicBonus(current.bonus):null,
  hint:['playing','complete-wait'].includes(r.phase)&&current&&(r.paused?r.pauseHintRemaining<=0:Date.now()>=r.hintAt)?current.hint:null,
  reveal:r.phase==='reveal'&&current?revealData(r):null
  });
};
function publicBonus(b){return {type:b.type,prompt:b.prompt,choices:b.type==='multiple'?b.choices:undefined};}
function revealData(r){const q=r.questions[r.index];return {videoId:q.videoId,start:q.start,end:q.end,title:q.title,song:q.song,bonusPrompt:q.bonus.prompt,bonusAnswer:q.bonus.type==='multiple'?q.bonus.choices[q.bonus.correct]:q.bonus.answer,firstWinner:r.firstWinner,bonusWinner:r.bonusWinner,
  firstAnswer:r.firstWinner?r.questions[r.index].title:null,
  reason:r.reason,hint:r.deadline>r.hintAt?q.hint:null};}
function system(r,message){if(!/님 (?:히든 )?정답 \+1점$/.test(message))return;io.to(r.code).emit('chat',{system:true,text:message,at:Date.now()});}
function cleanupTimer(r){if(r.timer){clearTimeout(r.timer);r.timer=null;}if(r.hintTimer){clearTimeout(r.hintTimer);r.hintTimer=null;}if(r.advanceTimer){clearTimeout(r.advanceTimer);r.advanceTimer=null;}}
// Move straight to the next question when BOTH the main and hidden answers are solved.
// Otherwise keep the normal five-second answer reveal on timeout/skip.
function advanceRound(r){
  cleanupTimer(r);
  r.index++;
  if(r.index>=r.questions.length){
    r.phase='finished';r.paused=false;r.revealUntil=0;r.firstWinner=null;r.bonusWinner=null;r.votes.clear();emitRoom(r);
    system(r,'모든 문제가 종료되었습니다!');
  }else beginRound(r);
}
function reveal(r,reason){
  if(r.phase!=='playing'||r.paused)return;
  cleanupTimer(r);
  if(reason==='skip')io.to(r.code).emit('game-sfx',{type:'skip'});
  const q=r.questions[r.index];
  if(reason==='skip'&&q.bonus.type!=='none'&&r.firstWinner&&r.bonusWinner){
    // Both answers are already visible; do not enter the 5s reveal phase.
    r.phase='complete-wait';r.reason=reason;r.revealUntil=Date.now()+COMPLETE_SKIP_DELAY;emitRoom(r);
    r.advanceTimer=setTimeout(()=>{if(r.phase==='complete-wait')advanceRound(r);},COMPLETE_SKIP_DELAY);
    return;
  }
  r.phase='reveal';r.paused=false;r.reason=reason;
  r.revealUntil=Date.now()+REVEAL_DELAY;
  emitRoom(r);
  system(r,reason==='skip'?'스킵 투표로 정답을 공개합니다.':'영상 재생 구간 시간이 지나 정답을 공개합니다.');
  r.advanceTimer=setTimeout(()=>{
    if(r.phase!=='reveal'||r.paused)return;
    advanceRound(r);
  },REVEAL_DELAY);
}
function beginRound(r){cleanupTimer(r);r.phase='playing';r.paused=false;r.pauseRemaining=0;r.pauseHintRemaining=0;r.pauseRevealRemaining=0;r.revealUntil=0;r.firstWinner=null;r.bonusWinner=null;r.votes.clear();const q=r.questions[r.index];const duration=Math.round((q.end-q.start)*1000);const now=Date.now();r.deadline=now+duration;r.hintAt=now+HINT_AT;r.timer=setTimeout(()=>reveal(r,'time'),duration);if(duration>HINT_AT){r.hintTimer=setTimeout(()=>{if(r.phase==='playing'){io.to(r.code).emit('hint',r.questions[r.index].hint);io.to(r.code).emit('game-sfx',{type:'hint'});}},HINT_AT);}emitRoom(r);system(r,`${r.index+1}번 문제 시작!`);}
function makeCode(){let c;do{c=crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(rooms.has(c));return c;}
function parseVideo(s){s=sanitize(s,500);if(/^[\w-]{11}$/.test(s))return s;try{const u=new URL(s);let id='';if(['youtu.be','www.youtu.be'].includes(u.hostname))id=u.pathname.split('/')[1];else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(u.hostname)){id=u.pathname==='/watch'?u.searchParams.get('v'):(u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)||[])[1];}return /^[\w-]{11}$/.test(id||'')?id:null;}catch{return null;}}
function parseQuestions(input){if(!Array.isArray(input)||input.length<1||input.length>100)throw Error('문제는 1~100개 등록하세요.');return input.map((x,i)=>{
 const videoId=parseVideo(x.videoUrl);const start=Number(x.startTime??0),end=Number(x.endTime??40);
 if(!videoId||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>200000)throw Error(`${i+1}번 영상 주소 또는 구간 오류`);
 const title=sanitize(x.answer,150),song=sanitize(x.songName,150),hint=sanitize(x.hintText,300),aliases=sanitize(x.aliases,400);
 if(!title)throw Error(`${i+1}번 작품명 정답 누락`);
 const type=['none','text','multiple'].includes(x.bonusType)?x.bonusType:'none';
 const b={type,prompt:sanitize(x.bonusQuestion,300),answer:sanitize(x.bonusAnswer,150),aliases:sanitize(x.bonusAliases,400),choices:Array.isArray(x.choices)?x.choices.slice(0,4).map(s=>sanitize(s,150)):[],correct:Number(x.correctChoice??0)};
 if(type!=='none'&&!b.prompt)throw Error(`${i+1}번 보너스 문제 누락`);
 if(type==='text'&&!b.answer)throw Error(`${i+1}번 보너스 정답 누락`);
 if(type==='multiple'&&(b.choices.length!==4||b.choices.some(c=>!c)||!Number.isInteger(b.correct)||b.correct<0||b.correct>3||new Set(b.choices.map(norm)).size!==4))throw Error(`${i+1}번 객관식 선택지 오류`);
 return {videoId,start,end,title,song,hint,aliases,bonus:b};
 });}
function respond(cb,data){if(typeof cb==='function')cb(data);}
io.on('connection',socket=>{
 socket.on('create',({name}={},cb)=>{name=sanitize(name,20);if(!name)return respond(cb,{error:'닉네임을 입력하세요.'});if(socket.data.room)return respond(cb,{error:'이미 방에 참가했습니다.'});const code=makeCode();const r={code,host:socket.id,players:new Map(),questions:[],phase:'lobby',index:0,votes:new Set(),timer:null,hintTimer:null,advanceTimer:null,paused:false,pauseRemaining:0,pauseHintRemaining:0,pauseRevealRemaining:0,firstWinner:null,bonusWinner:null,deadline:0,hintAt:0,revealUntil:0};r.players.set(socket.id,{id:socket.id,name,score:0});rooms.set(code,r);socket.data.room=code;socket.join(code);respond(cb,{ok:true,code});emitRoom(r);system(r,`${name}님이 방을 만들었습니다.`);});
 socket.on('join',({code,name}={},cb)=>{code=sanitize(code,10).toUpperCase();name=sanitize(name,20);const r=rooms.get(code);if(!r)return respond(cb,{error:'방을 찾을 수 없습니다.'});if(!name)return respond(cb,{error:'닉네임을 입력하세요.'});if(socket.data.room)return respond(cb,{error:'이미 방에 참가했습니다.'});if(r.players.size>=16)return respond(cb,{error:'최대 16명까지 참가할 수 있습니다.'});if(r.phase!=='lobby')return respond(cb,{error:'게임 중에는 참가할 수 없습니다.'});r.players.set(socket.id,{id:socket.id,name,score:0});socket.data.room=code;socket.join(code);respond(cb,{ok:true,code});emitRoom(r);system(r,`${name}님이 참가했습니다.`);});
 socket.on('start',({questions,shuffle=true}={},cb)=>{const r=getRoom(socket);if(!r||r.host!==socket.id)return respond(cb,{error:'방장만 시작할 수 있습니다.'});if(r.phase!=='lobby'&&r.phase!=='finished')return respond(cb,{error:'지금은 시작할 수 없습니다.'});let qs;try{qs=parseQuestions(questions);}catch(e){return respond(cb,{error:e.message});}if(shuffle){for(let i=qs.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[qs[i],qs[j]]=[qs[j],qs[i]];}}r.questions=qs;r.index=0;for(const p of r.players.values())p.score=0;beginRound(r);respond(cb,{ok:true});});
 socket.on('answer',({stage,answer}={},cb)=>{const r=getRoom(socket);if(!r||r.phase!=='playing'||r.paused||Date.now()>=r.deadline)return respond(cb,{error:'답안 제출 시간이 아닙니다.'});const q=r.questions[r.index],p=r.players.get(socket.id);if(!p)return;const a=sanitize(answer,200);if(stage===1){if(r.firstWinner)return respond(cb,{error:'1단계 정답자가 이미 나왔습니다.'});if(match(a,q.title,q.aliases)){r.firstWinner=p.name;p.score++;respond(cb,{ok:true,correct:true});io.to(r.code).emit('game-sfx',{type:'correct'});system(r,`${p.name}님 정답 +1점`);io.to(r.code).emit('answer-revealed',{stage:1,answer:q.title,index:r.index});if(q.bonus.type!=='none')io.to(r.code).emit('game-sfx',{type:'hidden'});emitRoom(r);/* 제한 시간 또는 스킵 시까지 문제 유지 */}else respond(cb,{ok:true,correct:false});}else if(stage===2){if(!r.firstWinner||q.bonus.type==='none')return respond(cb,{error:'보너스 문제가 아직 공개되지 않았습니다.'});if(r.bonusWinner)return respond(cb,{error:'보너스 정답자가 이미 나왔습니다.'});const correct=q.bonus.type==='multiple'?Number.isInteger(answer)&&answer===q.bonus.correct:match(a,q.bonus.answer,q.bonus.aliases);if(correct){r.bonusWinner=p.name;p.score++;respond(cb,{ok:true,correct:true});io.to(r.code).emit('game-sfx',{type:'correct'});system(r,`${p.name}님 히든 정답 +1점`);io.to(r.code).emit('answer-revealed',{stage:2,answer:q.bonus.type==='multiple'?q.bonus.choices[q.bonus.correct]:q.bonus.answer,index:r.index});emitRoom(r);/* 히든 정답 후에도 음악과 타이머는 계속 진행; 제한 시간 또는 스킵 시 공개 */}else respond(cb,{ok:true,correct:false});}else respond(cb,{error:'잘못된 단계입니다.'});});
 socket.on('skip',(_,cb)=>{const r=getRoom(socket);if(!r||r.phase!=='playing'||r.paused)return respond(cb,{error:'일시정지 중에는 스킵할 수 없습니다.'});if(r.votes.has(socket.id))return respond(cb,{error:'이미 투표했습니다.'});r.votes.add(socket.id);respond(cb,{ok:true});emitRoom(r);system(r,`${r.players.get(socket.id)?.name||'플레이어'}님 스킵 투표 (${r.votes.size}/${Math.floor(r.players.size/2)+1})`);if(r.votes.size>r.players.size/2)reveal(r,'skip');});
 socket.on('hostSkip',(_,cb)=>{const r=getRoom(socket);if(!r||r.host!==socket.id)return respond(cb,{error:'방장만 즉시 스킵할 수 있습니다.'});if(r.phase!=='playing'||r.paused)return respond(cb,{error:'진행 중인 문제에서만 스킵할 수 있습니다.'});respond(cb,{ok:true});reveal(r,'skip');});
 socket.on('togglePause',(_,cb)=>{const r=getRoom(socket);if(!r||!['playing','reveal'].includes(r.phase))return respond(cb,{error:'진행 중인 게임이 없습니다.'});if(r.host!==socket.id)return respond(cb,{error:'방장만 전체 게임을 일시정지할 수 있습니다.'});const now=Date.now();if(!r.paused){r.pauseRemaining=r.phase==='playing'?Math.max(0,r.deadline-now):0;r.pauseHintRemaining=r.phase==='playing'?Math.max(0,r.hintAt-now):0;r.pauseRevealRemaining=r.phase==='reveal'?Math.max(0,r.revealUntil-now):0;cleanupTimer(r);r.paused=true;}else{r.paused=false;if(r.phase==='playing'){r.deadline=now+r.pauseRemaining;r.hintAt=now+r.pauseHintRemaining;r.timer=setTimeout(()=>reveal(r,'time'),r.pauseRemaining);if(r.pauseHintRemaining>0&&r.pauseHintRemaining<r.pauseRemaining){r.hintTimer=setTimeout(()=>{if(r.phase==='playing'&&!r.paused){io.to(r.code).emit('hint',r.questions[r.index].hint);io.to(r.code).emit('game-sfx',{type:'hint'});}},r.pauseHintRemaining);}}else if(r.phase==='reveal'){r.revealUntil=now+r.pauseRevealRemaining;r.advanceTimer=setTimeout(()=>{if(r.phase!=='reveal'||r.paused)return;advanceRound(r);},r.pauseRevealRemaining);}}emitRoom(r);respond(cb,{ok:true,paused:r.paused});});
 socket.on('next',(_,cb)=>{const r=getRoom(socket);if(!r||r.host!==socket.id)return respond(cb,{error:'방장만 다음 문제로 진행할 수 있습니다.'});if(r.phase!=='reveal')return respond(cb,{error:'정답 공개 중에만 가능합니다.'});return respond(cb,{error:'5초 후 자동으로 다음 문제로 넘어갑니다.'});});
  socket.on('chat',(msg,cb)=>{const r=getRoom(socket);if(!r)return respond(cb,{error:'방을 찾을 수 없습니다.'});const p=r.players.get(socket.id);if(!p)return;const now=Date.now();if(now-(socket.data.lastChat||0)<550)return respond(cb,{error:'채팅은 잠시 기다렸다 보내세요.'});socket.data.lastChat=now;const text=sanitize(msg,200);if(!text)return respond(cb,{error:'메시지를 입력하세요.'});
    let correctChat=false;
    if(r.phase==='playing'&&!r.paused&&now<r.deadline){
      const q=r.questions[r.index];
      if(!r.firstWinner)correctChat=match(text,q.title,q.aliases);
      else if(q.bonus.type==='text'&&!r.bonusWinner)correctChat=match(text,q.bonus.answer,q.bonus.aliases);
      else if(q.bonus.type==='multiple'&&!r.bonusWinner){const n=Number(text.trim());correctChat=Number.isInteger(n)&&n>=1&&n<=4&&n-1===q.bonus.correct;}
    }
    io.to(r.code).emit('chat',{name:p.name,text,at:now,correct:correctChat});
    if(r.phase==='playing'&&!r.paused&&now<r.deadline){const q=r.questions[r.index];let stage=0,answer=text;
      if(!r.firstWinner)stage=1;
      else if(q.bonus.type!=='none'&&!r.bonusWinner){stage=2;if(q.bonus.type==='multiple'){const num=Number(text.trim());answer=Number.isInteger(num)&&num>=1&&num<=4?num-1:-1;}}
      if(stage){const listeners=socket.listeners('answer');if(listeners.length)listeners[0]({stage,answer},()=>{});}
    }
    respond(cb,{ok:true});
  });
 socket.on('disconnect',()=>{const r=getRoom(socket);if(!r)return;const p=r.players.get(socket.id);r.players.delete(socket.id);r.votes.delete(socket.id);if(r.players.size===0){cleanupTimer(r);rooms.delete(r.code);return;}if(r.host===socket.id)r.host=r.players.keys().next().value;system(r,`${p?.name||'플레이어'}님이 나갔습니다.`);if(r.phase==='playing'&&!r.paused&&r.votes.size>r.players.size/2)reveal(r,'skip');else emitRoom(r);});
});
// Submission storage: Supabase REST, server-only secret key. No local JSON state.
const INVITE_CODE=process.env.INVITE_CODE||'';
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'';
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY||'';
function secureEqual(a,b){a=Buffer.from(String(a||''));b=Buffer.from(String(b||''));return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function isAdmin(req){return !!ADMIN_PASSWORD&&secureEqual(req.get('x-admin-password'),ADMIN_PASSWORD);}
function owner(req){return String(req.get('x-submitter-token')||'');}
function tokenHash(token){return crypto.createHash('sha256').update(token).digest('hex');}
function configured(){return !!INVITE_CODE&&!!ADMIN_PASSWORD&&!!SUPABASE_URL&&!!SUPABASE_SECRET_KEY;}
async function db(table,method='GET',query='',body){
 if(!SUPABASE_URL||!SUPABASE_SECRET_KEY)throw Error('Supabase 환경변수를 확인해 주세요.');
 const response=await fetch(`${SUPABASE_URL}/rest/v1/${table}${query?('?'+query):''}`,{
  method,headers:{'apikey':SUPABASE_SECRET_KEY,'Authorization':`Bearer ${SUPABASE_SECRET_KEY}`,'Content-Type':'application/json','Prefer':'return=representation'},
  body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)
 });
 if(!response.ok){const detail=await response.text();console.error('Supabase request failed',response.status,detail.slice(0,500));throw Error('데이터베이스 요청에 실패했습니다. 서버 로그와 SQL 설정을 확인해 주세요.');}
 return response.status===204?[]:await response.json();
}
function asyncRoute(fn){return (req,res)=>Promise.resolve(fn(req,res)).catch(e=>{console.error('Submission API:',e);if(!res.headersSent)res.status(503).json({error:e.message||'저장소 연결 오류'});});}
async function submitter(req){const token=owner(req);if(!/^[a-f0-9]{64}$/.test(token))return null;const rows=await db('ost_submitters','GET',`token_hash=eq.${tokenHash(token)}&select=id,nickname&limit=1`);return rows[0]||null;}
function asItem(x){return {id:x.id,nickname:x.author_nickname,status:x.status,question:x.question,createdAt:x.created_at,aiRequested:!!x.ai_requested,aiStatus:x.ai_status||null,aiResult:x.ai_result||null};}
function validQuestion(q){parseQuestions([q]);return q;}
// AI-only requests are drafts, never playable questions until reviewed.
function validAiDraft(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('문제 정보 오류');
 const videoUrl=sanitize(input.videoUrl,1000);
 if(!parseVideo(videoUrl))throw Error('올바른 유튜브 URL을 입력하세요.');
 const q={...input,videoUrl,answer:sanitize(input.answer,150),aliases:sanitize(input.aliases,400),songName:sanitize(input.songName,150),hintText:sanitize(input.hintText,300)};
 const start=Number(q.startTime??0),end=Number(q.endTime??45);
 q.startTime=Number.isFinite(start)&&start>=0&&start<200000?start:0;
 q.endTime=Number.isFinite(end)&&end>q.startTime&&end<=200000?end:q.startTime+45;
 // Empty hidden questions should not be treated as completed hidden quizzes.
 if(!q.bonusQuestion||!String(q.bonusQuestion).trim())q.bonusType='none';
 return q;
}
function validateSubmission(input,aiRequested){return aiRequested?validAiDraft(input):validQuestion(input);}

app.use('/api/submissions',express.json({limit:'150kb'}));
app.use('/api/ai',express.json({limit:'150kb'}));
app.post('/api/submissions/access',asyncRoute(async(req,res)=>{
 if(!configured())return res.status(503).json({error:'서버 환경변수 설정이 필요합니다.'});
 if(!secureEqual(req.body?.inviteCode,INVITE_CODE))return res.status(403).json({error:'초대코드가 올바르지 않습니다.'});
 const nickname=sanitize(req.body?.nickname,20);if(!nickname)return res.status(400).json({error:'닉네임을 입력하세요.'});
 const token=crypto.randomBytes(32).toString('hex');
 await db('ost_submitters','POST','',{token_hash:tokenHash(token),nickname});
 res.json({token,nickname});
}));
app.get('/api/submissions/mine',asyncRoute(async(req,res)=>{
 const u=await submitter(req);if(!u)return res.status(401).json({error:'다시 입장해 주세요.'});
 const rows=await db('ost_questions','GET',`author_id=eq.${u.id}&select=id,author_nickname,status,question,ai_requested,ai_status,ai_result,created_at&order=created_at.desc`);
 res.json(rows.map(asItem));
}));
// Public-to-invited-submitters metadata only: never expose answer, video URL or hidden quiz.
app.get('/api/submissions/list',asyncRoute(async(req,res)=>{
 const u=await submitter(req);if(!u)return res.status(401).json({error:'다시 입장해 주세요.'});
 const rows=await db('ost_questions','GET','select=id,author_nickname,status,ai_requested,ai_status,created_at&order=created_at.desc&limit=200');
 res.json({items:rows.map(x=>({id:x.id,nickname:x.author_nickname,status:x.status,aiRequested:!!x.ai_requested,aiStatus:x.ai_status||null,createdAt:x.created_at,isMine:false})),limited:rows.length===200});
}));
app.post('/api/submissions',asyncRoute(async(req,res)=>{
 const admin=isAdmin(req);const u=admin?null:await submitter(req);
 if(!admin&&!u)return res.status(401).json({error:'초대코드로 입장하거나 관리자 비밀번호를 입력해 주세요.'});
 const aiRequested=req.body?.aiRequested===true;let q;try{q=validateSubmission(req.body?.question,aiRequested);}catch(e){return res.status(400).json({error:e.message});}
 const row={author_id:admin?null:u.id,author_nickname:admin?'관리자':u.nickname,question:q,status:admin&&!aiRequested?'approved':'pending',youtube_url:q.videoUrl,start_time:q.startTime,end_time:q.endTime,answer:q.answer,ai_requested:aiRequested,ai_status:aiRequested?'queued':null};
 const rows=await db('ost_questions','POST','',row);
 res.json({ok:true,id:rows[0].id,status:row.status});
}));
app.put('/api/submissions/:id',asyncRoute(async(req,res)=>{
 const u=await submitter(req);if(!u)return res.status(401).json({error:'다시 입장해 주세요.'});
 const aiRequested=req.body?.aiRequested===true;let q;try{q=validateSubmission(req.body?.question,aiRequested);}catch(e){return res.status(400).json({error:e.message});}
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(404).json({error:'문제를 찾을 수 없습니다.'});
 const rows=await db('ost_questions','PATCH',`id=eq.${id}&author_id=eq.${u.id}&status=eq.pending`,{question:q,youtube_url:q.videoUrl,start_time:q.startTime,end_time:q.endTime,answer:q.answer,ai_requested:aiRequested,ai_status:aiRequested?'queued':null,ai_result:null,updated_at:new Date().toISOString()});
 if(!rows.length)return res.status(404).json({error:'승인 대기 중인 내 문제만 수정할 수 있습니다.'});res.json({ok:true});
}));
app.get('/api/submissions/admin',asyncRoute(async(req,res)=>{
 if(!isAdmin(req))return res.status(403).json({error:'관리자 인증 실패'});
 const rows=await db('ost_questions','GET','select=id,author_nickname,status,question,ai_requested,ai_status,ai_result,created_at&order=created_at.desc&limit=1000');
 res.json({items:rows.map(asItem),approved:rows.filter(x=>x.status==='approved').length});
}));
app.patch('/api/submissions/admin/:id',asyncRoute(async(req,res)=>{
 if(!isAdmin(req))return res.status(403).json({error:'관리자 인증 실패'});
 if(!['approved','rejected','pending'].includes(req.body?.status))return res.status(400).json({error:'상태 오류'});
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(404).json({error:'문제를 찾을 수 없습니다.'});
 const update={status:req.body.status,updated_at:new Date().toISOString()};
 if(req.body.status==='approved'&&!req.body.question){
  const existing=await db('ost_questions','GET',`id=eq.${id}&select=question&limit=1`);
  if(!existing.length)return res.status(404).json({error:'문제를 찾을 수 없습니다.'});
  try{validQuestion(existing[0].question);}catch(e){return res.status(400).json({error:'정답과 히든 문제를 완성한 후 승인하세요: '+e.message});}
 }

 if(req.body.question){let q;try{q=validQuestion(req.body.question);}catch(e){return res.status(400).json({error:e.message});}Object.assign(update,{question:q,youtube_url:q.videoUrl,start_time:q.startTime,end_time:q.endTime,answer:q.answer});}
 const rows=await db('ost_questions','PATCH',`id=eq.${id}`,update);
 if(!rows.length)return res.status(404).json({error:'문제를 찾을 수 없습니다.'});res.json({ok:true});
}));
app.get('/api/submissions/admin/export',asyncRoute(async(req,res)=>{
 if(!isAdmin(req))return res.status(403).json({error:'관리자 인증 실패'});
 const rows=await db('ost_questions','GET','status=eq.approved&select=question&order=created_at.asc&limit=100');
 res.json(rows.map(x=>x.question));
}));


// v4.74 AI workflow: only explicitly opted-in, pending submissions are writable.
function adminOnly(req,res){if(!isAdmin(req)){res.status(403).json({error:'관리자 인증 실패'});return false;}return true;}
function validId(raw){const id=Number(raw);return Number.isSafeInteger(id)&&id>0?id:null;}
function aiPayload(x){return {id:x.id,answer:x.question?.answer,videoUrl:x.question?.videoUrl,status:x.status,aiStatus:x.ai_status,aiResult:x.ai_result};}
app.get('/api/ai/jobs',asyncRoute(async(req,res)=>{
 if(!adminOnly(req,res))return;
 const rows=await db('ost_questions','GET','ai_requested=eq.true&status=eq.pending&select=id,question,status,ai_status,ai_result&order=id.asc&limit=1000');
 res.json({items:rows.map(aiPayload)});
}));
app.post('/api/ai/result/:id',asyncRoute(async(req,res)=>{
 if(!adminOnly(req,res))return;
 const id=validId(req.params.id),r=req.body||{};
 if(!id)return res.status(400).json({error:'ID 오류'});
 const start=Number(r.start_seconds),end=Number(r.end_seconds);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end-start<40||end-start>65)return res.status(400).json({error:'분석 구간 오류'});
 const current=await db('ost_questions','GET',`id=eq.${id}&ai_requested=eq.true&status=eq.pending&select=id,question,ai_result&limit=1`);
 if(current.length!==1)return res.status(409).json({error:'대상 문제 없음 또는 이미 승인됨'});
 if(current[0].ai_result&&!r.replace)return res.status(409).json({error:'기존 분석 결과가 있어 덮어쓰지 않습니다.'});
 const result={start_seconds:start,end_seconds:end,candidates:Array.isArray(r.candidates)?r.candidates.slice(0,5):[],analyzed_at:new Date().toISOString()};
 const rows=await db('ost_questions','PATCH',`id=eq.${id}&ai_requested=eq.true&status=eq.pending`,{ai_result:result,ai_status:'ready',updated_at:new Date().toISOString()});
 if(rows.length!==1)return res.status(409).json({error:'대상 변경됨'});
 res.json({ok:true,id});
}));
app.post('/api/ai/error/:id',asyncRoute(async(req,res)=>{
 if(!adminOnly(req,res))return;
 const id=validId(req.params.id);if(!id)return res.status(400).json({error:'ID 오류'});
 await db('ost_questions','PATCH',`id=eq.${id}&ai_requested=eq.true&status=eq.pending&ai_status=eq.queued`,{ai_status:'failed'});
 res.json({ok:true});
}));
app.post('/api/ai/apply/:id',asyncRoute(async(req,res)=>{
 if(!adminOnly(req,res))return;
 const id=validId(req.params.id);if(!id)return res.status(400).json({error:'ID 오류'});
 const rows=await db('ost_questions','GET',`id=eq.${id}&ai_requested=eq.true&status=eq.pending&ai_status=eq.ready&select=id,question,ai_result&limit=1`);
 if(rows.length!==1||!rows[0].ai_result)return res.status(409).json({error:'적용할 결과가 없습니다.'});
 const old=rows[0],q={...old.question,startTime:old.ai_result.start_seconds,endTime:old.ai_result.end_seconds};
 try{validQuestion(q);}catch(e){return res.status(400).json({error:e.message});}
 const changed=await db('ost_questions','PATCH',`id=eq.${id}&ai_requested=eq.true&status=eq.pending&ai_status=eq.ready`,{question:q,start_time:q.startTime,end_time:q.endTime,ai_status:'applied',updated_at:new Date().toISOString()});
 if(changed.length!==1)return res.status(409).json({error:'동시 변경 감지'});
 res.json({ok:true});
}));
// v4.76: read-only result lookup for administrator-local questions.
// Never writes to the game or the submission row.
app.get('/api/ai/admin-result/:id',asyncRoute(async(req,res)=>{
 if(!adminOnly(req,res))return;
 const id=validId(req.params.id);if(!id)return res.status(400).json({error:'ID 오류'});
 const rows=await db('ost_questions','GET',`id=eq.${id}&author_id=is.null&ai_requested=eq.true&status=eq.pending&select=id,question,ai_status,ai_result&limit=1`);
 if(rows.length!==1)return res.status(404).json({error:'해당 관리자 AI 요청을 찾을 수 없습니다.'});
 const x=rows[0];
 res.json({id:x.id,videoUrl:x.question?.videoUrl,answer:x.question?.answer,aiStatus:x.ai_status,aiResult:x.ai_result});
}));
app.get('/api/ai/hidden-export',asyncRoute(async(req,res)=>{
 if(!adminOnly(req,res))return;
 const rows=await db('ost_questions','GET','ai_requested=eq.true&status=eq.pending&select=id,question&order=id.asc&limit=1000');
 res.json({format:'ost-hidden-v1',items:rows.map(x=>({id:x.id,answer:x.question?.answer,videoUrl:x.question?.videoUrl,hiddenQuestion:'',hiddenAnswer:'',hiddenAliases:''}))});
}));
app.post('/api/ai/hidden-preview',asyncRoute(async(req,res)=>{
 if(!adminOnly(req,res))return;
 const items=req.body?.items;
 if(!Array.isArray(items)||items.length>1000)return res.status(400).json({error:'items 배열 오류'});
 const ids=new Set(),changes=[];
 for(const x of items){const id=validId(x.id);if(!id||ids.has(id)||!sanitize(x.hiddenQuestion,300)||!sanitize(x.hiddenAnswer,150))return res.status(400).json({error:'ID 중복 또는 히든 문제 누락'});ids.add(id);}
 const rows=await db('ost_questions','GET','ai_requested=eq.true&status=eq.pending&select=id,question&limit=1000');
 const byId=new Map(rows.map(x=>[Number(x.id),x]));
 for(const x of items){const row=byId.get(Number(x.id));if(!row||row.question?.answer!==x.answer||row.question?.videoUrl!==x.videoUrl)return res.status(409).json({error:`ID ${x.id}: 원본 불일치 또는 승인된 문제`});changes.push({id:x.id,answer:x.answer,hiddenQuestion:sanitize(x.hiddenQuestion,300),hiddenAnswer:sanitize(x.hiddenAnswer,150),hiddenAliases:sanitize(x.hiddenAliases,400)});}
 res.json({count:changes.length,changes});
}));
app.post('/api/ai/hidden-import',asyncRoute(async(req,res)=>{
 if(!adminOnly(req,res))return;
 const items=req.body?.items;
 if(!Array.isArray(items)||items.length>1000)return res.status(400).json({error:'items 배열 오류'});
 const ids=new Set();for(const x of items){const id=validId(x.id);if(!id||ids.has(id)||!sanitize(x.hiddenQuestion,300)||!sanitize(x.hiddenAnswer,150))return res.status(400).json({error:'ID 중복 또는 빈 정답'});ids.add(id);}
 const rows=await db('ost_questions','GET','ai_requested=eq.true&status=eq.pending&select=id,question&limit=1000');
 const byId=new Map(rows.map(x=>[Number(x.id),x]));
 for(const x of items){const row=byId.get(Number(x.id));if(!row||row.question?.answer!==x.answer||row.question?.videoUrl!==x.videoUrl)return res.status(409).json({error:`ID ${x.id}: 원본 불일치`});}
 // Database-side backup of every original row before any update. Partial failures can be restored from these snapshots.
 const batch=crypto.randomUUID();
 await db('ost_ai_backups','POST','',items.map(x=>({batch_id:batch,question_id:Number(x.id),original_question:byId.get(Number(x.id)).question})));
 let updated=0;
 for(const x of items){const row=byId.get(Number(x.id));const q={...row.question,bonusType:'text',bonusQuestion:sanitize(x.hiddenQuestion,300),bonusAnswer:sanitize(x.hiddenAnswer,150),bonusAliases:sanitize(x.hiddenAliases,400)};
  try{validQuestion(q);}catch(e){return res.status(400).json({error:e.message,batch,updated});}
  const result=await db('ost_questions','PATCH',`id=eq.${Number(x.id)}&ai_requested=eq.true&status=eq.pending`,{question:q,updated_at:new Date().toISOString()});
  if(result.length!==1)return res.status(409).json({error:'변경 중 충돌. 백업 ID로 복원 가능',batch,updated});updated++;
 }
 res.json({ok:true,updated,batch});
}));
app.post('/api/ai/restore/:batch',asyncRoute(async(req,res)=>{
 if(!adminOnly(req,res))return;
 const batch=String(req.params.batch||'');if(!/^[a-f0-9-]{36}$/.test(batch))return res.status(400).json({error:'백업 ID 오류'});
 const backups=await db('ost_ai_backups','GET',`batch_id=eq.${batch}&select=question_id,original_question&limit=1000`);
 if(!backups.length)return res.status(404).json({error:'백업 없음'});
 let restored=0;
 for(const b of backups){const q=b.original_question;const result=await db('ost_questions','PATCH',`id=eq.${b.question_id}&status=eq.pending`,{question:q,start_time:q.startTime,end_time:q.endTime,updated_at:new Date().toISOString()});restored+=result.length;}
 res.json({ok:true,restored});
}));

const PORT=Number(process.env.PORT)||3000;
server.listen(PORT,'0.0.0.0',()=>console.log(`OST 마추기 서버: http://localhost:${PORT}`));
