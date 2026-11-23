import { gsap } from 'gsap';
import { DURATION } from './smoke-physics.mjs';
import { createSmokeRenderer } from '../../../frontend/src/profile-effects/smoke-renderer.ts';
const find = (selector) => document.querySelector(selector);
const card = find('.card'), avatar = find('.avatar'), overlay = find('.effect');
const scroller = find('.content'), scrub = find('#scrub');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const query = new URLSearchParams(location.search);
const continuous = query.get('variant') === 'continuous';
find('h1').textContent = continuous ? 'FumaÃ§a contÃ­nua' : 'FumaÃ§a em tufos';
const smoke = createSmokeRenderer(overlay, continuous);
let layout;
let lastTime = 0;
function measure() {
  const area = overlay.getBoundingClientRect();
  const source = avatar.getBoundingClientRect();
  if (!area.width || !area.height) return;
  const next = { width: area.width, height: area.height,
    x: source.left-area.left+source.width*.77, y: source.top-area.top+source.height*.60 };
  if (JSON.stringify(next) !== JSON.stringify(layout)) {
    layout = next;
    smoke.resize(layout);
  }
  render(lastTime);
}
function render(seconds) {
  lastTime=Math.max(0,Math.min(seconds,DURATION));
  if(query.has('debug')) {
    scrub.value=lastTime;
    find('output').value=lastTime.toFixed(2).replace('.',',')+' s';
  }
  if (!layout || reduced.matches || card.hidden || lastTime === 0 || lastTime === DURATION) {
    overlay.style.visibility = 'hidden';
    return;
  }
  overlay.style.visibility = 'visible';
  smoke.render(lastTime);
}
const clock={seconds:0};
const timeline=gsap.timeline({paused:true});
timeline.to(clock,{seconds:DURATION,duration:DURATION,ease:'none',onUpdate:()=>render(clock.seconds)});
function replay() {
  card.hidden=false;
  scroller.scrollTop=0;
  measure();
  timeline.pause(0);
  render(0);
  if(!reduced.matches) timeline.play(0);
}
find('.replay').addEventListener('click',replay);
find('.close').addEventListener('click',()=>{
  timeline.pause(0); card.hidden=true; render(0); find('.replay').focus();
});
find('.action').addEventListener('click',()=>{find('.action-feedback').hidden=false;});
find('#layout').addEventListener('change',({target})=>{card.dataset.layout=target.value;replay();});
find('#bio-size').addEventListener('change',({target})=>{
  find('.bio').textContent=target.value==='short'
    ? 'Entre nuvens e jogos depois da meia-noite.'
    : 'Entre nuvens e jogos depois da meia-noite. Coleciono histÃ³rias de RPG, desenho cenÃ¡rios de fantasia e sempre tenho uma nova playlist para uma sessÃ£o longa. Se me vir online tarde, provavelmente estou pintando um cÃ©u ou preparando a prÃ³xima aventura.';
  replay();
});
reduced.addEventListener('change',()=>{timeline.pause(0);render(0);});
const observer=new ResizeObserver(measure);
observer.observe(overlay);
scroller.addEventListener('scroll',measure,{passive:true});
if(query.has('debug')) find('#debug').hidden=false;
scrub.addEventListener('input',()=>{timeline.pause();render(Number(scrub.value));});
window.DUR=DURATION;
window.render=t=>{timeline.pause();render(t);};
window.addEventListener('message', event => {
  if (event.source !== parent) return;
  if (event.data === 'replay-smoke') replay();
});
window.addEventListener('pagehide',()=>timeline.pause());
measure();
window.READY=true;
if(query.has('frame')) window.render(Number(query.get('frame')));
else if(!query.has('clean')) replay();
