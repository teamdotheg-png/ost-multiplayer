(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OSTHint=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const initials='ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
// No automatic translation, transliteration or spelling out unknown foreign titles.
function toReading(raw){return String(raw||'');}
function consonants(text){return [...String(text||'')].map(ch=>{const n=ch.charCodeAt(0)-44032;if(n>=0&&n<11172)return initials[Math.floor(n/588)];if(initials.includes(ch))return ch;if(/[0-9]/.test(ch))return ch;if(ch==='×'||ch==='+')return ch;if(/\s/.test(ch))return ' ';return '';}).join('').replace(/ +/g,' ').trim();}

// Reviewed readings: user-provided NINE and Korean aliases already in the bank.
const representative={
  "NINE": "나인",
  "G선상의 마왕": "지선상의 마왕",
  "Aster": "아스터",
  "Signal Heart": "시그널 하트",
  "V.G. NEO": "브이 지 네오",
  "H2O ~풋프린츠 인 더 샌드~": "에이치투오",
  "H2O -풋프린츠 인 더 샌드-": "에이치투오",
  "포르티시모 EXS": "포르티시모 엑제스",
  "아쿠에리안 에이지 Perpetual Period": "아쿠에리안 에이지 퍼페추얼 피리어드",
  "별하늘에 걸린 다리 AA": "별하늘에 걸린 다리 더블에이",
  "시크릿 게임 CODE:Revise": "시크릿 게임 코드 리바이스",
  "대마인 아사기 ZERO": "대마인 아사기 제로",
  "D.S.i.F. -달 세뇨- 인 퓨처": "달 세뇨 인 퓨처",
  "A 프로필": "에이 프로필",
  "T.P. 사쿠라": "티피 사쿠라",
  "발드 스카이 다이브 X": "발드 스카이 다이브엑스",
  "파스텔 차임 Continue": "파스텔 차임 컨티뉴",
  "9-nine- 소라이로 소라우타 소라노오토": "나인 소라이로 소라우타 소라노오토",
  "9-nine- 코코노츠 코코노카 코코노이로": "나인 코코노츠 코코노카 코코노이로"
};
function mainTitle(raw){return String(raw||'').split(/[~～]/,1)[0].trim();}
function koreanTitle(answer,verified='',aliases=''){
 const title=mainTitle(answer), reading=mainTitle(verified);
 const reviewed=representative[String(answer||'')]||representative[Object.keys(representative).find(k=>k.toLowerCase()===title.toLowerCase())];
 const valid=s=>/[가-힣0-9]/.test(s)&&!/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/.test(s);
 if(valid(reading))return reading;
 if(reviewed)return reviewed;
 if(valid(title))return title;
 return '';
}
function safeHint(answer,verified='',legacy='',aliases=''){
 return consonants(koreanTitle(answer,verified,aliases));
}
function partialIndices(title,input){
 const chars=[...title], positions=[];let compact='';
 chars.forEach((ch,i)=>{if(!/\s/.test(ch)){compact+=ch;positions.push(i);}});
 const guess=String(input||'').replace(/\s/g,'');
 if(!/^[가-힣]{2,}$/.test(guess))return [];
 const found=[];let from=0,at;
 while((at=compact.indexOf(guess,from))!==-1){for(let i=at;i<at+guess.length;i++)found.push(positions[i]);from=at+1;}
 return found;
}
function revealedHint(title,indices=[]){const open=new Set(indices);return [...title].map((c,i)=>open.has(i)?c:(/\s/.test(c)?' ':consonants(c))).join('').replace(/ +/g,' ').trim();}
return {toReading,consonants,safeHint,koreanTitle,partialIndices,revealedHint};
});

