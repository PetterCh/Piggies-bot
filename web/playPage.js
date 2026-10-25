// Genera la página /play/:id: HTML ultraligero con un <canvas> y el motor de animación (sin librerías).
// Hoja de sprites (frames numerados desde 1, de izquierda a derecha y de arriba abajo):
//   1-4  = IDLE (quieto)  ·  5-12 = caminar  ·  13-16 (los ÚLTIMOS 4) = comer.  Hoja por defecto: 4 columnas × 4 filas, frames de 91×100.
// La cuadrícula se define en sprite-config.json (o en el campo "sprite" de un metadato, que manda sobre el general):
//   { "frameWidth": 91, "frameHeight": 100, "columns": 4, "frames": 16, "scale": 2, "facing": "right" }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderPlayPage({ id, meta, sprite, nonce }) {
  const name = String(meta.name || `Piggie #${id}`).slice(0, 80);
  const data = { id, name, sprite: { ...sprite, url: `/piggies/sprites/${id}.png` } };
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>${esc(name)}</title>
<meta name="robots" content="noindex"><link rel="icon" href="data:,">
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#1b1626;color:#f3e9ff;font-family:system-ui,sans-serif}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:10px;user-select:none;-webkit-user-select:none}
h1{margin:0;font-size:1.1rem}#c{width:100%;max-width:720px;aspect-ratio:8/5;image-rendering:pixelated;border-radius:12px;background:#4c9a4a;touch-action:none}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center}
button{font:inherit;border:0;border-radius:10px;padding:10px 18px;background:#ff7eb6;color:#2a1030;font-weight:700;cursor:pointer}
button:active{transform:scale(.96)}small{opacity:.7}#msg{color:#ffb4b4}
.pad{display:none;grid-template-columns:repeat(3,52px);grid-template-rows:repeat(2,52px);gap:6px}
.pad button{padding:0;font-size:1.3rem;background:#7a5cc7;color:#fff}.pad .u{grid-column:2}.pad .l{grid-row:2;grid-column:1}.pad .d{grid-row:2;grid-column:2}.pad .r{grid-row:2;grid-column:3}
@media (pointer:coarse){.pad{display:grid}.keys{display:none}}
</style></head><body>
<h1 id="t"></h1>
<canvas id="c" width="640" height="400"></canvas>
<div class="bar"><button id="eat"></button><small class="keys" id="k"></small></div>
<div class="pad"><button class="u" data-k="up">▲</button><button class="l" data-k="left">◀</button><button class="d" data-k="down">▼</button><button class="r" data-k="right">▶</button></div>
<div id="msg"></div>
<script nonce="${nonce}">
window.__PIGGY__=${json};
(function(){
var D=window.__PIGGY__,S=D.sprite,es=/^es/i.test(navigator.language||'');
var TXT=es?{eat:'🍖 Comer',keys:'Mueve con WASD o las flechas · E = comer',err:'No se pudo cargar el sprite de este Piggie.'}:{eat:'🍖 Eat',keys:'Move with WASD or arrow keys · E = eat',err:'Could not load this Piggie\\'s sprite.'};
document.getElementById('t').textContent='🐷 '+D.name;document.getElementById('eat').textContent=TXT.eat;document.getElementById('k').textContent=TXT.keys;
var cv=document.getElementById('c'),ctx=cv.getContext('2d'),W=cv.width,H=cv.height;
var img=new Image();img.onerror=function(){document.getElementById('msg').textContent=TXT.err;};img.onload=init;img.src=S.url;
var keys={up:0,down:0,left:0,right:0},st={x:W/2,y:H*0.7,dir:1,mode:'idle',t:0},fw,fh,cols,n,A,scale,dw,dh;
function range(a,b){var r=[];for(var i=a;i<b;i++)r.push(i);return r;}
function init(){
  if(S.frameWidth){fw=S.frameWidth;fh=S.frameHeight||img.height;cols=S.columns||Math.max(1,Math.floor(img.width/fw));n=S.frames||cols*Math.max(1,Math.floor(img.height/fh));}
  else{n=S.frames||16;fw=Math.floor(img.width/n);fh=img.height;cols=n;}
  A={idle:range(0,Math.min(4,n)),walk:range(4,Math.min(12,n)),eat:range(Math.max(0,n-4),n)};
  if(!A.walk.length)A.walk=A.idle;
  scale=S.scale||Math.max(1,Math.round(180/fh));dw=fw*scale;dh=fh*scale;st.y=Math.min(H-10,Math.max(dh+10,H*0.7));
  last=performance.now();requestAnimationFrame(loop);
}
var KEYMAP={ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};
addEventListener('keydown',function(e){var k=KEYMAP[e.key];if(k){keys[k]=1;e.preventDefault();}else if(e.key==='e'||e.key==='E')eat();});
addEventListener('keyup',function(e){var k=KEYMAP[e.key];if(k){keys[k]=0;e.preventDefault();}});
addEventListener('blur',function(){keys.up=keys.down=keys.left=keys.right=0;});
Array.prototype.forEach.call(document.querySelectorAll('.pad button'),function(b){var k=b.getAttribute('data-k');
  b.addEventListener('pointerdown',function(e){e.preventDefault();keys[k]=1;});['pointerup','pointerleave','pointercancel'].forEach(function(ev){b.addEventListener(ev,function(){keys[k]=0;});});});
function eat(){if(A&&st.mode!=='eat'){st.mode='eat';st.t=0;}}
document.getElementById('eat').addEventListener('click',eat);
var FPS={idle:5,walk:12,eat:8},last=0;
function setMode(m){if(st.mode!==m){st.mode=m;st.t=0;}}
function loop(now){
  var dt=Math.min(0.05,(now-last)/1000);last=now;
  if(st.mode!=='eat'){
    var vx=keys.right-keys.left,vy=keys.down-keys.up;
    if(vx||vy){var l=Math.hypot(vx,vy),sp=130;st.x+=vx/l*sp*dt;st.y+=vy/l*sp*dt;if(vx)st.dir=vx>0?1:-1;setMode('walk');}else setMode('idle');
  }
  st.x=Math.max(dw/2,Math.min(W-dw/2,st.x));st.y=Math.max(Math.min(dh+10,H-10),Math.min(H-10,st.y));
  st.t+=dt;var seq=A[st.mode],i=Math.floor(st.t*FPS[st.mode]);
  if(st.mode==='eat'&&i>=seq.length){setMode('idle');seq=A.idle;i=0;}
  draw(seq[i%seq.length]);requestAnimationFrame(loop);
}
function draw(f){
  var g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#8fd3ff');g.addColorStop(0.3,'#8fd3ff');g.addColorStop(0.3,'#5fb85a');g.addColorStop(1,'#3f8f43');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(st.x,st.y,dw*0.32,dh*0.07,0,0,6.3);ctx.fill();
  ctx.imageSmoothingEnabled=false;ctx.save();ctx.translate(Math.round(st.x),Math.round(st.y));
  if((st.dir<0)!==(S.facing==='left'))ctx.scale(-1,1);
  ctx.drawImage(img,(f%cols)*fw,Math.floor(f/cols)*fh,fw,fh,-dw/2,-dh,dw,dh);ctx.restore();
}
})();
</script></body></html>`;
}

module.exports = { renderPlayPage };
