import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function diagnosticMultiset(diagnostics,root){
 const counts=new Map();const prefix=resolve(root).replaceAll('\\','/')+'/';
 for(const item of diagnostics){
  const file=(item.file??'').replaceAll('\\','/');
  const message=item.message.replaceAll('\\','/').replaceAll(prefix,'');
  const normalized={file:isAbsolute(file)?relative(root,file).replaceAll('\\','/'):file,code:item.code,message};
  const key=JSON.stringify(normalized);const previous=counts.get(key);
  counts.set(key,{...normalized,count:(previous?.count??0)+1});
 }
 return [...counts.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
export function addedDiagnostics(current,baseline){
 const key=d=>JSON.stringify([d.file,d.code,d.message]);
 const existing=new Map(baseline.map(d=>[key(d),d.count]));
 return current.flatMap(d=>d.count>(existing.get(key(d))??0)?[{...d,count:d.count-(existing.get(key(d))??0)}]:[]);
}
export function checkWebTypes(args=process.argv.slice(2)){
 const options={root:repository,project:'educlaw-web/tsconfig.app.json',baseline:'educlaw-web/typecheck-baseline.json'};
 for(let n=0;n<args.length;n+=2){const key=args[n]?.slice(2);if(!Object.hasOwn(options,key)||!args[n+1])throw Error('Invalid typecheck arguments');options[key]=args[n+1];}
 const require=createRequire(resolve(repository,'educlaw-web/package.json'));
 const ts=require('typescript');
 const project=resolve(options.root,options.project);
 const parsed=ts.getParsedCommandLineOfConfigFile(project,{}, {...ts.sys,onUnRecoverableConfigFileDiagnostic:d=>{throw Error(ts.flattenDiagnosticMessageText(d.messageText,'\n'));}});
 if(!parsed||parsed.errors.length)throw Error('TypeScript configuration failed to load');
 const stored=JSON.parse(readFileSync(resolve(options.root,options.baseline),'utf8'));
 if(stored.version!==1||!Array.isArray(stored.diagnostics))throw Error('Invalid diagnostic baseline');
 for(const d of stored.diagnostics)if(typeof d.file!=='string'||isAbsolute(d.file)||!Number.isInteger(d.code)||typeof d.message!=='string'||!Number.isSafeInteger(d.count)||d.count<1)throw Error('Invalid diagnostic baseline entry');
 const program=ts.createProgram(parsed.fileNames,parsed.options);
 const current=diagnosticMultiset(ts.getPreEmitDiagnostics(program).map(d=>({file:d.file?.fileName??'',code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')})),options.root);
 const added=addedDiagnostics(current,stored.diagnostics);
 const total=ds=>ds.reduce((sum,d)=>sum+d.count,0);
 const report={baselineDiagnostics:total(stored.diagnostics),currentDiagnostics:total(current),addedDiagnostics:total(added),added};
 console.log(JSON.stringify(report,null,2));
 return added.length?1:0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=checkWebTypes();}catch(error){console.error(`Typecheck gate failed: ${error instanceof Error?error.message:'unknown error'}`);process.exitCode=2;}
}
