import { createRuntime, queueJob, serviceHealth, readOnlySetupStatus, dispatchBackground, strictJobId, publicError, logOperationalError } from './lib/analysis-runtime.mjs';

export default async (request,context) => {
  if(!['GET','POST'].includes(request.method))return new Response('Method not allowed',{status:405});
  let runtime;
  try {
    if(request.method==='GET'&&new URL(request.url).searchParams.get('setup')==='1')
      return Response.json(await readOnlySetupStatus(context),{headers:{'cache-control':'no-store'}});
    runtime=await createRuntime(context);
    if(request.method==='GET')return Response.json(await serviceHealth(runtime),{headers:{'cache-control':'no-store'}});
    if(Number(request.headers.get('content-length')??0)>256)return new Response('Request too large',{status:413});
    const text=await request.text();if(text.length>256)return new Response('Request too large',{status:413});
    let body;try{body=JSON.parse(text);}catch{return new Response('Invalid JSON',{status:400});}
    if(!body||Array.isArray(body)||Object.keys(body).join(',')!=='jobId')return new Response('Only jobId is accepted',{status:400});
    let id;try{id=strictJobId(body.jobId);}catch{return new Response('Invalid jobId',{status:400});}
    const result=await queueJob(runtime,id);
    if(result.accepted)context.waitUntil(dispatchBackground(context).catch(logOperationalError));
    return Response.json(result,{status:result.accepted?202:409,headers:{'cache-control':'no-store'}});
  } catch(error) {logOperationalError(error);return Response.json({ready:false,available:false,...publicError()},{status:503,headers:{'cache-control':'no-store'}});}
  finally {await runtime?.provider.destroy();await runtime?.db.pool.end();}
};
export const config={path:'/api/s0ul/worker',method:['GET','POST'],rateLimit:{action:'rate_limit',aggregateBy:'ip',windowSize:60,windowLimit:12}};
