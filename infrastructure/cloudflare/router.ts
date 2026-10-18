type Service = {fetch(request:Request):Promise<Response>};
type Bindings = {BACKEND_A:Service;BACKEND_B:Service;ASSETS:Service;PUBLIC_BASE_URL:string};
const backendPath=(path:string)=>path.startsWith('/api/')||path.startsWith('/oauth/')||path.startsWith('/sso/')||path.startsWith('/auth/')||path.startsWith('/.well-known/')||path==='/mcp';
async function healthy(service:Service,origin:string) {
  try{
    const response=await service.fetch(new Request(origin+'/api/health',{signal:AbortSignal.timeout(2500)}));
    const ok=response.ok;await response.body?.cancel();return ok;
  }catch{return false;}
}
export async function routeRequest(request:Request,env:Bindings,choose=()=>crypto.getRandomValues(new Uint32Array(1))[0]%2) {
  const url=new URL(request.url),base=new URL(env.PUBLIC_BASE_URL);
  if(url.host!==base.host)return new Response('Not found',{status:404});
  if(url.protocol!=='https:')return Response.redirect(base.origin+url.pathname+url.search,301);
  if(!backendPath(url.pathname)) {
    const response=await env.ASSETS.fetch(request);
    const result=new Response(response.body,response);
    result.headers.set('X-Content-Type-Options','nosniff');result.headers.set('X-Frame-Options','DENY');
    result.headers.set('Strict-Transport-Security','max-age=31536000');result.headers.set('Referrer-Policy','no-referrer');
    if(url.pathname==='/'||url.pathname==='/sw.js')result.headers.set('Cache-Control','no-cache');
    return result;
  }
  // Read-only deployment probes must verify the named replica, never a fallback.
  const target=request.method==='GET'&&url.pathname==='/api/ready'?url.searchParams.get('replica'):null;
  if(target!==null&&!['replica-a','replica-b'].includes(target))return Response.json({error:'Invalid readiness target.'},{status:400});
  const candidates=target?[target==='replica-a'?env.BACKEND_A:env.BACKEND_B]:choose()===0?[env.BACKEND_A,env.BACKEND_B]:[env.BACKEND_B,env.BACKEND_A];
  for(const candidate of candidates) {
    if(!await healthy(candidate,base.origin))continue;
    try{
      const cleanHeaders=new Headers(request.headers);
      for(const key of ['x-tracker-user','x-tracker-replica','x-forwarded-host'])cleanHeaders.delete(key);
      const response=await candidate.fetch(new Request(request,{headers:cleanHeaders,redirect:'manual'}));
      // Never replay a forwarded request: the backend may have committed a write.
      return response;
    }catch{return Response.json({error:'Request interrupted. Check your records before retrying.'},{status:503,headers:{'Cache-Control':'no-store'}});}
  }
  return Response.json({error:target?'Requested replica is unavailable.':'Both application replicas are unavailable.'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'10'}});
}
export default {fetch:(request:Request,env:Bindings)=>routeRequest(request,env)};
