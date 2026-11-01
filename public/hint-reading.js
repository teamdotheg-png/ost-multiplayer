(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OSTHint=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const initials='ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const letterNames={a:'에이',b:'비',c:'씨',d:'디',e:'이',f:'에프',g:'지',h:'에이치',i:'아이',j:'제이',k:'케이',l:'엘',m:'엠',n:'엔',o:'오',p:'피',q:'큐',r:'알',s:'에스',t:'티',u:'유',v:'브이',w:'더블유',x:'엑스',y:'와이',z:'지'};
const words={summer:'서머',pockets:'포켓츠',making:'메이킹',lovers:'러버즈',lover:'러버',riddle:'리들',joker:'조커',dal:'달',segno:'세뇨',knowing:'노잉',friend:'프렌드',love:'러브',story:'스토리',heart:'하트',dream:'드림',days:'데이즈',day:'데이',blue:'블루',sky:'스카이',white:'화이트',black:'블랙',moon:'문',star:'스타',stars:'스타즈',school:'스쿨',life:'라이프',kiss:'키스',sweet:'스위트',sugar:'슈거',pure:'퓨어',secret:'시크릿',future:'퓨처',world:'월드',orange:'오렌지',after:'애프터',rain:'레인',rainbow:'레인보우',angel:'엔젤',flower:'플라워',flowers:'플라워즈',princess:'프린세스',princesses:'프린세스즈',sakura:'사쿠라',select:'셀렉트',oblige:'오블리주',plus:'플러스',spin:'스핀',d:'디',s:'에스'};
const kana={'キャ':'캬','キュ':'큐','キョ':'쿄','シャ':'샤','シュ':'슈','ショ':'쇼','チャ':'차','チュ':'추','チョ':'초','ニャ':'냐','ニュ':'뉴','ニョ':'뇨','ヒャ':'햐','ヒュ':'휴','ヒョ':'효','ミャ':'먀','ミュ':'뮤','ミョ':'묘','リャ':'랴','リュ':'류','リョ':'료','ギャ':'갸','ギュ':'규','ギョ':'교','ジャ':'자','ジュ':'주','ジョ':'조','ビャ':'뱌','ビュ':'뷰','ビョ':'뵤','ピャ':'퍄','ピュ':'퓨','ピョ':'표'};
const basic='アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ';
const reading='아 이 우 에 오 카 키 쿠 케 코 사 시 스 세 소 타 치 츠 테 토 나 니 누 네 노 하 히 후 헤 호 마 미 무 메 모 야 유 요 라 리 루 레 로 와 오 ㄴ 가 기 구 게 고 자 지 즈 제 조 다 지 즈 데 도 바 비 부 베 보 파 피 푸 페 포'.split(' ');
for(let i=0;i<basic.length;i++)kana[basic[i]]=reading[i]||'';
function latinWord(word){const w=word.toLowerCase();if(words[w])return words[w];if(w.length===1)return letterNames[w]||'';
// Unknown terms: conservative letter-name pronunciation is always Korean and never exposes the answer.
return [...w].map(ch=>letterNames[ch]||'').join('');}
function toReading(raw){let text=String(raw||'').normalize('NFKC');text=text.replace(/[A-Za-z]+/g,latinWord);text=text.replace(/[\u3041-\u3096]/g,c=>String.fromCharCode(c.charCodeAt(0)+96));text=text.replace(/(キャ|キュ|キョ|シャ|シュ|ショ|チャ|チュ|チョ|ニャ|ニュ|ニョ|ヒャ|ヒュ|ヒョ|ミャ|ミュ|ミョ|リャ|リュ|リョ|ギャ|ギュ|ギョ|ジャ|ジュ|ジョ|ビャ|ビュ|ビョ|ピャ|ピュ|ピョ|[\u30a1-\u30ff])/g,c=>kana[c]||'');return text;}
function consonants(text){return [...String(text||'')].map(ch=>{const n=ch.charCodeAt(0)-44032;if(n>=0&&n<11172)return initials[Math.floor(n/588)];if(initials.includes(ch))return ch;if(/[0-9]/.test(ch))return ch;if(ch==='×'||ch==='+')return ch;if(/\s/.test(ch))return ' ';return '';}).join('').replace(/ +/g,' ').trim();}
function safeHint(answer,verified='',legacy=''){
 // Never display imported legacy hints: they may contain the full answer.
 const mainTitle=String(answer||'').split(/[~～]/,1)[0].trim();
 const verifiedMain=String(verified||'').split(/[~～]/,1)[0].trim();
 // Ignore stale verified readings that include subtitle text.
 const verifiedWords=verifiedMain.split(/\s+/);
 const titleWords=mainTitle.split(/\s+/);
 const reading=(verifiedWords.length>titleWords.length+2 && /[~～]/.test(String(answer||''))) ? mainTitle : (verifiedMain||mainTitle);
 return consonants(toReading(reading));
}
return {toReading,consonants,safeHint};
});
