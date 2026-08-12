import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { TAXONOMY } from "/Users/mateobesse/surfrider-datacard-web/src/lib/taxonomy.ts";
import { cropCell, decodeGray, inkFraction, loadPng, referenceTarget, registerBestSide }
  from "/Users/mateobesse/surfrider-datacard-web/scripts/lib/cardvision.mjs";

const REF="/Users/mateobesse/surfrider-datacard-web/assets/reference";
const INK=0.025;
const colName=(i)=>{let n=i,s="";while(n>0){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;};

function readSheet(path){
  const parts=unzipSync(new Uint8Array(readFileSync(path)));const dec=new TextDecoder();
  const shared=[];
  if(parts["xl/sharedStrings.xml"]){for(const si of dec.decode(parts["xl/sharedStrings.xml"]).split("<si>").slice(1))
    shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m=>m[1]).join(""));}
  const sheet=dec.decode(parts["xl/worksheets/sheet1.xml"]);const values=new Map();
  for(const m of sheet.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g)){
    const [,col,row,attrs,body]=m; if(body.includes("<f"))continue;
    const v=/<v>([\s\S]*?)<\/v>/.exec(body); if(!v)continue;
    const val=attrs.includes('t="s"')?shared[Number(v[1])]:v[1]; if(val===undefined||val==="")continue;
    if(!values.has(col))values.set(col,new Map()); values.get(col).set(Number(row),val);
  }
  return values;
}

const [dir,xlsx]=process.argv.slice(2);
const maps={front:JSON.parse(readFileSync(join(REF,"cells.front.json"),"utf8")),
            back:JSON.parse(readFileSync(join(REF,"cells.back.json"),"utf8"))};
const targets={front:referenceTarget(loadPng(join(REF,"blank-front.png")),maps.front),
               back:referenceTarget(loadPng(join(REF,"blank-back.png")),maps.back)};
const sheet=readSheet(xlsx);
const files=readdirSync(dir).filter(f=>/\.jpe?g$/i.test(f))
  .sort((a,b)=>(parseInt(a.replace(/\D/g,""),10)||0)-(parseInt(b.replace(/\D/g,""),10)||0));

// inked rows per card
const cardInk=[];
for(let i=0;i+1<files.length;i+=2){
  const rows=new Set();
  for(const k of [i,i+1]){
    const reg=registerBestSide(decodeGray(join(dir,files[k])),targets);
    if(!reg.trusted)continue; // a page that would not align tells us nothing
    for(const cell of maps[reg.side].cells){
      const ex=(maps[reg.side].exclusions||[]).some(e=>cell.total.x<e.x+e.width&&cell.total.x+cell.total.width>e.x&&cell.total.y<e.y+e.height&&cell.total.y+cell.total.height>e.y);
      if(ex)continue;
      if(inkFraction(cropCell(reg.image,cell.total))>=INK) rows.add(cell.row);
    }
  }
  cardInk.push(rows);
}
console.log(`cards: ${cardInk.length}, mean inked rows/card: ${(cardInk.reduce((a,s)=>a+s.size,0)/cardInk.length).toFixed(1)}`);
console.log("\ncolumn offset test (precision = inked rows that have a sheet value):");
for(let off=-3;off<=3;off++){
  let hit=0,tot=0;
  cardInk.forEach((rows,idx)=>{
    const col=colName(3+idx+off); const c=sheet.get(col); if(!c)return;
    for(const r of rows){tot++; const v=Number(c.get(r)); if(Number.isFinite(v)&&v>0)hit++;}
  });
  console.log(`  offset ${String(off).padStart(2)}: ${tot?(hit/tot*100).toFixed(0):'-'}%  (${hit}/${tot})`);
}
