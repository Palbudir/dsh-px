import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
fs.mkdirSync('build-test',{recursive:true});
import {createServer} from 'node:http';
import {build} from 'esbuild';
await build({entryPoints:['src/main/network-proxy.ts'],bundle:true,platform:'node',format:'esm',outfile:'build-test/re08-network-proxy.mjs'});
const {resolveHarnessProxy}=await import(pathToFileURL(path.join(root,'build-test/re08-network-proxy.mjs')));
const {installProxyFromEnvironment,proxyRouteFor}=await import('../runtime/dsh/node_modules/@deepseek-ai/dsh-http-proxy/lib/index.js');
const {HttpFetchProvider}=await import('../runtime/dsh/node_modules/@deepseek-ai/dsh-web-fetch-http/lib/index.js');
const homeIndex=process.argv.indexOf('--home');
if(homeIndex<0||!process.argv[homeIndex+1])throw new Error('请显式提供 --home <DSH数据目录>');
const selected=await resolveHarnessProxy(path.resolve(process.argv[homeIndex+1]));
const env={...process.env,...selected.additions};
const dispose=await installProxyFromEnvironment({get:name=>env[name]?{value:env[name]}:undefined},()=>{});
const provider=new HttpFetchProvider({maxResponseBytes:2000000,maxBodyChars:4000,timeoutMs:15000,maxRedirects:5,userAgent:'DSH-PX/0.1.0-beta.re.0.8 acceptance'});
const urls=['https://nodejs.org/api/test.html','https://www.typescriptlang.org/docs/','https://react.dev/learn','https://developer.mozilla.org/en-US/docs/Web/JavaScript','https://docs.python.org/3/library/unittest.html','https://git-scm.com/docs/git-worktree','https://docs.npmjs.com/cli/v11/commands/npm-test','https://code.visualstudio.com/docs','https://github.com/deepseek-ai/deepseek-harness','https://doc.rust-lang.org/book/'];
const checks=[];
let hits=0;const server=createServer((req,res)=>{hits++;res.end('private fixture')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 for(let i=0;i<urls.length;i+=3)await Promise.all(urls.slice(i,i+3).map(async url=>{
  try{const r=await provider.fetch({url});checks.push({url,proxied:proxyRouteFor(new URL(url)).proxied,status:r.statusCode,chars:r.body.content.length,ok:r.statusCode===200&&r.body.content.length>0});}
  catch(e){checks.push({url,ok:false,code:e.code,message:e.message});}
 }));
 const url='http://127.0.0.1:'+server.address().port+'/';
 let blocked=false,code;
 try{await provider.fetch({url});}catch(e){code=e.code;blocked=e.code==='WEB_BLOCKED_URL';}
 const report={checkedAt:new Date().toISOString(),source:selected.status.source,public:checks,privateFixture:{blocked,code,requestsReceived:hits},runtime:'DSH 0.1.5-rc.2',app:'re.0.8'};
 fs.writeFileSync('build-test/re08-network-results.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 if(checks.some(c=>!c.ok)||!blocked||hits!==0)process.exitCode=1;
}finally{await new Promise(resolve=>server.close(resolve));await dispose();}
