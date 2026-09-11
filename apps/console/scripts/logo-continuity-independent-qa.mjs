import ts from 'typescript';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const base='apps/console/src/components/logo-animation/';
const uri=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64');
const piecesUri=uri(readFileSync(base+'logoPieces.ts','utf8'));
const {logoPieces}=await import(piecesUri);
const source=readFileSync(base+'logoChoreography.ts','utf8').replace("'./logoPieces'",JSON.stringify(piecesUri));
const {choreographyForPiece,sampleChoreography,LOGO_ASSEMBLED_AT,LOGO_DURATION}=await import(uri(source));
const result={pieces:logoPieces.length,uniqueIds:new Set(logoPieces.map(p=>p.id)).size,geometrySha256:createHash('sha256').update(JSON.stringify(logoPieces.map(({id,d})=>({id,d})))).digest('hex'),assembledAt:LOGO_ASSEMBLED_AT,duration:LOGO_DURATION,knots:0,maxPositionSpan:0,maxDerivativeDisagreement:0,invalidSamples:[],nonIncreasingTimes:[],finalErrors:[],familyCounts:{}};
const epsilon=1e-6;
for(const piece of logoPieces){
  const score=choreographyForPiece(piece.id,0,0),points=score.waypoints;
  result.familyCounts[score.family]=(result.familyCounts[score.family]??0)+1;
  for(let i=1;i<points.length;i++)if(points[i].time<=points[i-1].time)result.nonIncreasingTimes.push({id:piece.id,i});
  for(const point of points.slice(1,-1)){
    result.knots++;
    const left=sampleChoreography(points,point.time-epsilon),at=sampleChoreography(points,point.time),right=sampleChoreography(points,point.time+epsilon);
    for(const key of ['x','y','rotation','scale']){
      result.maxPositionSpan=Math.max(result.maxPositionSpan,Math.abs(right[key]-left[key]));
      result.maxDerivativeDisagreement=Math.max(result.maxDerivativeDisagreement,Math.abs((right[key]-at[key])/epsilon-(at[key]-left[key])/epsilon));
    }
  }
  for(let time=0;time<=LOGO_ASSEMBLED_AT;time+=1/240){const pose=sampleChoreography(points,time);if(!Object.values(pose).every(Number.isFinite)||pose.scale<=0)result.invalidSamples.push({id:piece.id,time,pose});}
  const final=sampleChoreography(points,LOGO_ASSEMBLED_AT);
  if(final.x!==0||final.y!==0||final.rotation!==0||final.scale!==1)result.finalErrors.push({id:piece.id,final});
}
const compact=process.argv.includes('--compact');
result.pass=result.pieces===32&&result.uniqueIds===32&&result.duration>=(compact?1.4:3.2)&&result.duration<=(compact?1.8:4)&&!result.invalidSamples.length&&!result.nonIncreasingTimes.length&&!result.finalErrors.length&&result.maxPositionSpan<.01&&result.maxDerivativeDisagreement<.1;
const output=compact?'scratchpad/qa/logo-compact':'scratchpad/qa/logo-continuous';
mkdirSync(output,{recursive:true});
writeFileSync(output+'/continuity.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
if(!result.pass)process.exitCode=1;
