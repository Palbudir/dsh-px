// Offline diagnostic reproduction. Materializes only synthetic fixtures under build-test/.
// It does not contact a model, open a user session, or modify the installed application.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const scratch=path.join(root,'build-test',`audit-repro-${Date.now()}`);
const snapshots={};
for(const name of ['before','after']){
 const snapshot=JSON.parse(fs.readFileSync(path.join(here,'evidence',`fixture-${name}.json`),'utf8'));snapshots[name]=snapshot;
 for(const [rel,content] of Object.entries(snapshot)){
  const target=path.resolve(scratch,name,rel),allowed=path.join(scratch,name)+path.sep;
  if(!target.startsWith(allowed))throw new Error('Unsafe fixture path');
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);
 }
}
const results={baselineVersion:'re.0.7 / DSH 0.1.5-rc.2',node:process.version};
for(const name of ['before','after']){
 const tests=name==='before'?['test/checkout.test.js']:['test/checkout.test.js','test/checkout.extra.test.js'];
 const result=spawnSync(process.execPath,['--test',...tests],{cwd:path.join(scratch,name),encoding:'utf8',timeout:20000});
 if(result.error)throw result.error;
 results[name]={exitCode:result.status,summary:result.stdout.split(/\r?\n/).filter(s=>/^ℹ (tests|pass|fail)|^# (tests|pass|fail)/.test(s)),stdout:result.stdout.replaceAll(scratch,'<scratch>'),stderr:result.stderr.replaceAll(scratch,'<scratch>')};
}
const {checkout}=await import(pathToFileURL(path.join(scratch,'after/src/checkout.js')));
results.holdouts=[];
for(const [name,items,stock] of [
 ['prototype-key',[{sku:'toString',price:100,qty:1}],{}],
 ['NaN-stock (contract clarification)',[{sku:'a',price:100,qty:1}],{a:NaN}],
 ['string-stock (contract clarification)',[{sku:'a',price:100,qty:1}],{a:'3'}]
]){try{const actual=checkout(items,stock);results.holdouts.push({name,expected:'throw under the stated/clarified contract',threw:false,actual,hasNaN:Object.values(actual.stock).some(Number.isNaN)});}catch(e){results.holdouts.push({name,threw:true,error:e.message});}}
const first=checkout([{sku:'a',price:100,qty:1}],{a:3});
try{results.frozenStockCounterexample={threw:false,actual:checkout([{sku:'a',price:100,qty:1}],Object.freeze(first.stock))};}catch(e){results.frozenStockCounterexample={threw:true,error:e.message};}
results.preservation={originalTestUnchanged:snapshots.before['test/checkout.test.js']===snapshots.after['test/checkout.test.js'],humanNotesUnchanged:snapshots.before['NOTES.md']===snapshots.after['NOTES.md']};
fs.writeFileSync(path.join(scratch,'reproduction.json'),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({scratch,before:results.before.summary,after:results.after.summary,holdouts:results.holdouts,frozenStockCounterexample:results.frozenStockCounterexample,preservation:results.preservation},null,2));
