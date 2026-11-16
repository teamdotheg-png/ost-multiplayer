(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OSTHint=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const initials='ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
// No automatic translation, transliteration or spelling out unknown foreign titles.
function toReading(raw){return String(raw||'');}
// One renderer for the initial hint and every partial reveal: never drop Latin tokens.
function renderHint(text,indices=[]){
 const chars=[...String(text||'')],open=new Set(indices);
 return chars.map((ch,i)=>{
  const n=ch.charCodeAt(0)-0xAC00;
  if(n>=0&&n<11172)return open.has(i)?ch:initials[Math.floor(n/588)];
  if(initials.includes(ch)||/[A-Za-z0-9]/.test(ch)||ch==='×'||ch==='+'||ch==='□')return ch;
  // Keep punctuation inside original abbreviations/edition tokens (Vol.2, A-2).
  if(/[.'’:_-]/.test(ch)&&/[A-Za-z0-9]/.test(chars[i-1]||'')&&/[A-Za-z0-9]/.test(chars[i+1]||''))return ch;
  if(/[!?]/.test(ch)&&/[A-Za-z]/.test(chars[i-1]||''))return ch;
  return /\s/.test(ch)?' ':'';
 }).join('').replace(/ +/g,' ').trim();
}
function consonants(text){return renderHint(text);}

// Reviewed readings: user-provided NINE and Korean aliases already in the bank.
const representative={
  "MUSICUS!": "뮤지쿠스",
  "H2O": "에이치 투 오",
  "9-nine-": "나인",
  "NINE": "나인",
  "RIDDLE JOKER": "리들 조커",
  "G선상의 마왕": "지선상의 마왕",
  "Aster": "아스터",
  "Signal Heart": "시그널 하트",
  "V.G. NEO": "브이 지 네오",
  "H2O ~풋프린츠 인 더 샌드~": "에이치 투 오",
  "H2O -풋프린츠 인 더 샌드-": "에이치 투 오",
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
// Exact reviewed names only: duplicate Latin title labels, not edition markers.
// Evidence and unchanged-title checks: data_import/hint-review26-results.json.
const reviewedMainTitles={
 '아카 -Aka-':'아카',
 '아스테리즘 -Astraythem-':'아스테리즘'
};
// Reviewed export exceptions. Do not generalize subtitle cuts or readings.
// Evidence: data_import/hint-review13-decisions.json.
const reviewedExportTitles={
 '러브2Quad':'러브2쿼드',
 '소녀는 언니를 사랑한다 Portable ~두 명의 엘더~':'소녀는 언니를 사랑한다 Portable 두 명의 엘더'
};
// Display-only privacy rules for the six remaining reviewed titles.
// □□□ is a constant placeholder, not a reading or the original word length.
// Keep answers/aliases and edition identity in the question data untouched.
const privateHintTitles={
 '시크릿 게임 -KILLER QUEEN- DEPTH EDITION':'시크릿 게임 □□□',
 '신 백은의 솔레이유 -ReANSWER-':'신 백은의 솔레이유',
 '공주님 LOVE 라이프!':'공주님 □□□ 라이프',
 '타유타마 -kiss on my deity-':'타유타마',
 '오레사마의 라그나Rock':'오레사마의 라그나□□□',
 '마호×로바 -Witches spiritual home-':'마호×로바'
};
function koreanTitle(answer,verified='',aliases=''){
 const title=mainTitle(answer),reading=mainTitle(verified);
 // User-confirmed display corrections only. Preserve custom verified readings.
 const original=String(answer||'');
 if(Object.hasOwn(privateHintTitles,original)){
  if(!reading||reading===title)return privateHintTitles[original];
  // A separate verified Korean reading remains usable. An alternate mixed
  // reading must not reintroduce literal English answers during partial reveals.
  if(/[A-Za-z]/.test(reading))return reading.replace(/[A-Za-z]+(?:[\s.'’:_-]+[A-Za-z]+)*/g,'□□□');
 }
 if(Object.hasOwn(reviewedExportTitles,original)&&(!reading||reading===title))return reviewedExportTitles[original];
 if(Object.hasOwn(reviewedMainTitles,original)&&(!reading||reading===title))return reviewedMainTitles[original];
 // Latest export contains this truncated reading. Reuse the already reviewed
 // EXS reading from the registered bank; do not override other custom readings.
 if(original==='포르티시모 EXS'&&reading==='포르티시모')return representative[original];
 if(/^H2O(?:$| [~\-])/.test(original)&&(!reading||reading===title||reading==='에이치투오'))return '에이치 투 오';
 if(/^9-nine-/.test(original)&&(!reading||reading===title))return title.replace(/^9-nine-/, '나인');
 const reviewed=representative[String(answer||'')]||representative[Object.keys(representative).find(k=>k.toLowerCase()===title.toLowerCase())];
 const korean=s=>/[가-힣]/.test(s)&&!/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/.test(s);
 // A verified Korean reading wins; reviewed mappings also work with older saved data.
 if(korean(reading))return reading;
 if(reviewed)return reviewed;
 if(korean(title))return title;
 // Mixed and unreviewed original titles must still produce a visible hint.
 // Preserve their original Latin/number tokens; this is NOT a new Korean reading.
 const fallback=reading||title;
 // Unverified all-foreign titles must not give away the answer.
 return /[가-힣]/.test(fallback)||!/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/.test(fallback)?fallback:'';
}

function safeHint(answer,verified='',legacy='',aliases=''){
 return consonants(koreanTitle(answer,verified,aliases))||'초성 확인 필요';
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
function revealedHint(title,indices=[]){return renderHint(title,indices); }
return {toReading,consonants,safeHint,koreanTitle,partialIndices,revealedHint};
});

