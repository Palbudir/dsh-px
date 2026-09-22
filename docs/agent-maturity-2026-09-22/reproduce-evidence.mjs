// Compile the current pure evidence module into a scratch artifact, then run diagnostic cases.
// Output captures behavior; these are known-defect probes, not assertions that defects should persist.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const scratch=path.join(root,'build-test',`audit-evidence-${Date.now()}`);fs.mkdirSync(scratch,{recursive:true});
await build({entryPoints:[path.join(root,'packages/dsh-px-taskflow/src/evidence.ts')],bundle:true,platform:'node',format:'esm',outfile:path.join(scratch,'evidence.mjs')});
const {reviewEvents,validateCheckpoint}=await import(pathToFileURL(path.join(scratch,'evidence.mjs')));
const start=(id,name,seq,args={})=>({seq,time:seq*10,type:'tool/call',data:{callId:id,name,arguments:args}});
const end=(id,seq,text)=>({seq,time:seq*10,type:'tool/result',data:{message:{content:[{type:'tool-result',toolCallId:id,isError:false,content:[{type:'text',text}]}]}}});
const probes=[];
probes.push({id:'B04',expected:'returned',actual:reviewEvents([start('r','read',1,{file_path:'log.txt'}),end('r',2,'历史命令输出：[exit code: 1]')]).executions[0].outcome});
probes.push({id:'B05',expected:[],actual:reviewEvents([start('v','str_replace_editor',1,{command:'view',path:'readme.md'}),end('v',2,'content')]).changedFiles});
const cp={goal:'finish',summary:'done',nextStep:'',state:'ready_for_review',evidence:['ok']};
const base=[start('ok','pwsh',1),end('ok',2,'pass'),start('cp','task_checkpoint',3),end('cp',4,JSON.stringify({checkpoint:cp}))];
probes.push({id:'B03',target:false,actual:reviewEvents([...base,start('r','read',5,{file_path:'a'}),end('r',6,'data')]).checkpointStale});
const many=[];for(let i=0;i<81;i++)many.push(start('c'+i,'read',i*2,{file_path:'x'.repeat(1200)}),end('c'+i,i*2+1,'x'.repeat(2400)));
let error=null;try{validateCheckpoint({...cp,evidence:['c0']},many);}catch(e){error=e.message;}
probes.push({id:'B06',target:'历史真实证据可引用',actual:error??'accepted'});
const r=reviewEvents(many);probes.push({id:'B07',bytes:Buffer.byteLength(JSON.stringify(r)),executions:r.executions.length,total:r.total,truncated:r.truncated});
fs.writeFileSync(path.join(scratch,'probes.json'),JSON.stringify(probes,null,2)+'\n');
console.log(JSON.stringify({scratch,probes},null,2));
