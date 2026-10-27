'use strict';
const express = require('express');
const http = require('http');
const {Server} = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server,{maxHttpBufferSize:1e6});
app.use(express.static(path.join(__dirname,'public')));
const rooms = new Map();
const DURATION = 45000, HINT_AT = 15000;
const norm = s => String(s??'').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const match = (input,main,aliases='') => {
  const a=norm(input); return !!a && [main,...String(aliases).split(',')].some(x=>norm(x)===a);
};
const sanitize = (s,n=100) => String(s??'').trim().slice(0,n);
const getRoom = socket => rooms.get(socket.data.room);
const memberList = r => [...r.players.values()].map(p=>({id:p.id,name:p.name,score:p.score,host:p.id===r.host}));
const safeQuestion = q => ({videoId:q.videoId,start:q.start,end:q.end,hasBonus:q.bonus.type!=='none',bonusType:q.bonus.type});
const emitRoom = r => io.to(r.code).emit('room',{
  code:r.code,phase:r.phase,host:r.host,players:memberList(r),total:r.questions.length,
  index:r.index,skipVotes:r.votes.size,skipNeeded:Math.floor(r.players.size/2)+1,
  firstWinner:r.firstWinner,bonusWinner:r.bonusWinner,
  deadline:r.deadline,hintAt:r.hintAt,
  question:r.phase==='playing'?safeQuestion(r.questions[r.index]):null,
  bonus:r.phase==='playing'&&r.firstWinner&&r.questions[r.index].bonus.type!=='none'?
    publicBonus(r.questions[r.index].bonus):null,
  hint:r.phase==='playing'&&Date.now()>=r.hintAt?r.questions[r.index].hint:null,
  reveal:r.phase==='reveal'?revealData(r):null
});
function publicBonus(b){return {type:b.type,prompt:b.prompt,choices:b.type==='multiple'?b.choices:undefined};}
function revealData(r){const q=r.questions[r.index];return {videoId:q.videoId,start:q.start,end:q.end,title:q.title,song:q.song,bonusPrompt:q.bonus.prompt,bonusAnswer:q.bonus.type==='multiple'?q.bonus.choices[q.bonus.correct]:q.bonus.answer,firstWinner:r.firstWinner,bonusWinner:r.bonusWinner,reason:r.reason};}
function system(r,message){io.to(r.code).emit('chat',{system:true,text:message,at:Date.now()});}
function cleanupTimer(r){if(r.timer){clearTimeout(r.timer);r.timer=null;}if(r.hintTimer){clearTimeout(r.hintTimer);r.hintTimer=null;}}
function reveal(r,reason){if(r.phase!=='playing')return;cleanupTimer(r);r.phase='reveal';r.reason=reason;emitRoom(r);system(r,reason==='skip'?'스킵 투표로 정답을 공개합니다.':reason==='complete'?'두 문제 정답이 확정되었습니다.':'45초가 지나 정답을 공개합니다.');}
function beginRound(r){cleanupTimer(r);r.phase='playing';r.firstWinner=null;r.bonusWinner=null;r.votes.clear();r.deadline=Date.now()+DURATION;r.hintAt=Date.now()+HINT_AT;r.timer=setTimeout(()=>reveal(r,'time'),DURATION);r.hintTimer=setTimeout(()=>{if(r.phase==='playing'){io.to(r.code).emit('hint',r.questions[r.index].hint);}},HINT_AT);emitRoom(r);system(r,`${r.index+1}번 문제 시작!`);}
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
 socket.on('create',({name}={},cb)=>{name=sanitize(name,20);if(!name)return respond(cb,{error:'닉네임을 입력하세요.'});if(socket.data.room)return respond(cb,{error:'이미 방에 참가했습니다.'});const code=makeCode();const r={code,host:socket.id,players:new Map(),questions:[],phase:'lobby',index:0,votes:new Set(),timer:null,hintTimer:null,firstWinner:null,bonusWinner:null,deadline:0,hintAt:0};r.players.set(socket.id,{id:socket.id,name,score:0});rooms.set(code,r);socket.data.room=code;socket.join(code);respond(cb,{ok:true,code});emitRoom(r);system(r,`${name}님이 방을 만들었습니다.`);});
 socket.on('join',({code,name}={},cb)=>{code=sanitize(code,10).toUpperCase();name=sanitize(name,20);const r=rooms.get(code);if(!r)return respond(cb,{error:'방을 찾을 수 없습니다.'});if(!name)return respond(cb,{error:'닉네임을 입력하세요.'});if(socket.data.room)return respond(cb,{error:'이미 방에 참가했습니다.'});if(r.players.size>=16)return respond(cb,{error:'최대 16명까지 참가할 수 있습니다.'});if(r.phase!=='lobby')return respond(cb,{error:'게임 중에는 참가할 수 없습니다.'});r.players.set(socket.id,{id:socket.id,name,score:0});socket.data.room=code;socket.join(code);respond(cb,{ok:true,code});emitRoom(r);system(r,`${name}님이 참가했습니다.`);});
 socket.on('start',({questions,shuffle=true}={},cb)=>{const r=getRoom(socket);if(!r||r.host!==socket.id)return respond(cb,{error:'방장만 시작할 수 있습니다.'});if(r.phase!=='lobby'&&r.phase!=='finished')return respond(cb,{error:'지금은 시작할 수 없습니다.'});let qs;try{qs=parseQuestions(questions);}catch(e){return respond(cb,{error:e.message});}if(shuffle){for(let i=qs.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[qs[i],qs[j]]=[qs[j],qs[i]];}}r.questions=qs;r.index=0;for(const p of r.players.values())p.score=0;beginRound(r);respond(cb,{ok:true});});
 socket.on('answer',({stage,answer}={},cb)=>{const r=getRoom(socket);if(!r||r.phase!=='playing'||Date.now()>=r.deadline)return respond(cb,{error:'답안 제출 시간이 아닙니다.'});const q=r.questions[r.index],p=r.players.get(socket.id);if(!p)return;const a=sanitize(answer,200);if(stage===1){if(r.firstWinner)return respond(cb,{error:'1단계 정답자가 이미 나왔습니다.'});if(match(a,q.title,q.aliases)){r.firstWinner=p.name;p.score++;respond(cb,{ok:true,correct:true});system(r,`${p.name}님이 작품명을 가장 먼저 맞혔습니다! (+1점)`);emitRoom(r);if(q.bonus.type==='none')reveal(r,'complete');}else respond(cb,{ok:true,correct:false});}else if(stage===2){if(!r.firstWinner||q.bonus.type==='none')return respond(cb,{error:'보너스 문제가 아직 공개되지 않았습니다.'});if(r.bonusWinner)return respond(cb,{error:'보너스 정답자가 이미 나왔습니다.'});const correct=q.bonus.type==='multiple'?Number.isInteger(answer)&&answer===q.bonus.correct:match(a,q.bonus.answer,q.bonus.aliases);if(correct){r.bonusWinner=p.name;p.score++;respond(cb,{ok:true,correct:true});system(r,`${p.name}님이 보너스 문제를 가장 먼저 맞혔습니다! (+1점)`);emitRoom(r);/* 히든 정답 후에도 음악과 타이머는 계속 진행; 제한 시간 또는 스킵 시 공개 */}else respond(cb,{ok:true,correct:false});}else respond(cb,{error:'잘못된 단계입니다.'});});
 socket.on('skip',(_,cb)=>{const r=getRoom(socket);if(!r||r.phase!=='playing')return respond(cb,{error:'진행 중인 문제가 없습니다.'});if(r.votes.has(socket.id))return respond(cb,{error:'이미 투표했습니다.'});r.votes.add(socket.id);respond(cb,{ok:true});emitRoom(r);system(r,`${r.players.get(socket.id)?.name||'플레이어'}님 스킵 투표 (${r.votes.size}/${Math.floor(r.players.size/2)+1})`);if(r.votes.size>r.players.size/2)reveal(r,'skip');});
 socket.on('next',(_,cb)=>{const r=getRoom(socket);if(!r||r.host!==socket.id)return respond(cb,{error:'방장만 다음 문제로 진행할 수 있습니다.'});if(r.phase!=='reveal')return respond(cb,{error:'정답 공개 중에만 가능합니다.'});r.index++;if(r.index>=r.questions.length){r.phase='finished';cleanupTimer(r);emitRoom(r);system(r,'모든 문제가 종료되었습니다!');}else beginRound(r);respond(cb,{ok:true});});
  socket.on('chat',(msg,cb)=>{const r=getRoom(socket);if(!r)return respond(cb,{error:'방을 찾을 수 없습니다.'});const p=r.players.get(socket.id);if(!p)return;const now=Date.now();if(now-(socket.data.lastChat||0)<550)return respond(cb,{error:'채팅은 잠시 기다렸다 보내세요.'});socket.data.lastChat=now;const text=sanitize(msg,200);if(!text)return respond(cb,{error:'메시지를 입력하세요.'});
    io.to(r.code).emit('chat',{name:p.name,text,at:now});
    if(r.phase==='playing'&&now<r.deadline){const q=r.questions[r.index];let stage=0,answer=text;
      if(!r.firstWinner)stage=1;
      else if(q.bonus.type!=='none'&&!r.bonusWinner){stage=2;if(q.bonus.type==='multiple'){const num=Number(text.trim());answer=Number.isInteger(num)&&num>=1&&num<=4?num-1:-1;}}
      if(stage){const listeners=socket.listeners('answer');if(listeners.length)listeners[0]({stage,answer},()=>{});}
    }
    respond(cb,{ok:true});
  });
 socket.on('disconnect',()=>{const r=getRoom(socket);if(!r)return;const p=r.players.get(socket.id);r.players.delete(socket.id);r.votes.delete(socket.id);if(r.players.size===0){cleanupTimer(r);rooms.delete(r.code);return;}if(r.host===socket.id)r.host=r.players.keys().next().value;system(r,`${p?.name||'플레이어'}님이 나갔습니다.`);if(r.phase==='playing'&&r.votes.size>r.players.size/2)reveal(r,'skip');else emitRoom(r);});
});
const PORT=Number(process.env.PORT)||3000;
server.listen(PORT,'0.0.0.0',()=>console.log(`OST 마추기 서버: http://localhost:${PORT}`));
