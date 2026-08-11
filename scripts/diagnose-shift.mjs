import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPng, decodeGray, classify } from "./lib/cardvision.mjs";

const REF = "/Users/mateobesse/surfrider-datacard-web/assets/reference";
const refs = { front: loadPng(join(REF,"blank-front.png")), back: loadPng(join(REF,"blank-back.png")) };

function rowProf({width,height,gray}){const o=new Float64Array(height);
  for(let y=0;y<height;y++){let s=0;const off=y*width;for(let x=0;x<width;x++)s+=255-gray[off+x];o[y]=s/width;}return o;}
function norm(a){let m=0;for(const v of a)m+=v;m/=a.length;const o=new Float64Array(a.length);let n=0;
  for(let i=0;i<a.length;i++){o[i]=a[i]-m;n+=o[i]*o[i];}n=Math.sqrt(n)||1;for(let i=0;i<o.length;i++)o[i]/=n;return o;}

const dir = process.argv[2];
const files = readdirSync(dir).filter(f=>/\.jpe?g$/i.test(f))
  .sort((a,b)=>(parseInt(a.replace(/\D/g,""),10)||0)-(parseInt(b.replace(/\D/g,""),10)||0)).slice(0, 8);

for (const f of files) {
  const pg = decodeGray(join(dir,f));
  const side = classify(pg).side;
  const A = norm(rowProf(refs[side])), B = norm(rowProf(pg));
  const scores = [];
  for (let s=-80;s<=80;s++){
    let sc=0; const st=Math.max(0,-s), en=Math.min(A.length,B.length-s);
    for(let i=st;i<en;i++) sc+=A[i]*B[i+s];
    scores.push([s,sc]);
  }
  scores.sort((a,b)=>b[1]-a[1]);
  const top = scores.slice(0,4).map(([s,v])=>`${s}:${v.toFixed(3)}`).join("  ");
  console.log(`${f.padEnd(9)} ${side.padEnd(5)} best shifts -> ${top}`);
}
