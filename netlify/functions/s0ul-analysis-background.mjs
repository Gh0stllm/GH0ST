import { requireProduction, internalTrigger, drainJobs } from './lib/analysis-runtime.mjs';

export default async (request,context) => {
  requireProduction(context);
  if(request.method!=='POST'||!internalTrigger(request))return new Response('Forbidden',{status:403});
  // Netlify retries can only resume the persisted exact hash; they cannot sign a
  // replacement while a broadcast outcome is unknown.
  await drainJobs(context);
};
export const config={background:true,path:'/api/s0ul/worker-run',method:'POST'};
