import { withRequestDatabase } from '../../backend/services/runtime';
import { openPostgres } from '../../backend/services/postgres';
import { expectedMigrations } from './migrations.generated';
import * as access from '../../backend/api/access';
import * as dashboard from '../../backend/api/dashboard';
import * as history from '../../backend/api/history';
import * as records from '../../backend/api/records';
import * as widget from '../../backend/api/widget';
import * as auth from '../../backend/api/supabase-auth';
import * as oauth from '../../backend/api/oauth';
import * as mcp from '../../backend/mcp/handler';
type Context = {waitUntil(promise:Promise<unknown>):void};
type Handler = (request:Request)=>Promise<Response>;
const routes:Record<string,Partial<Record<string,Handler>>> = {
  '/api/access':{GET:access.GET,POST:access.POST,DELETE:access.DELETE},
  '/api/dashboard':{GET:dashboard.GET},'/api/history':{GET:history.GET},
  '/api/records':{GET:records.GET,POST:records.POST,PATCH:records.PATCH,DELETE:records.DELETE},
  '/api/widget':{GET:widget.GET,POST:widget.POST,DELETE:widget.DELETE},
  '/sso/login':{GET:auth.login,POST:auth.login},'/auth/callback':{GET:auth.callback,POST:auth.callback},
  '/oauth/authorize':{GET:oauth.authorize,POST:oauth.authorize},'/oauth/token':{POST:r=>oauth.token(r)},'/oauth/revoke':{POST:r=>oauth.token(r,true)},
  '/mcp':{POST:mcp.POST},
  '/.well-known/oauth-authorization-server':{GET:async()=>oauth.metadata()},
  '/.well-known/oauth-protected-resource':{GET:async()=>oauth.metadata(true)},
  '/.well-known/oauth-protected-resource/mcp':{GET:async()=>oauth.metadata(true)},
};
export default {
  async fetch(request:Request,_bindings:unknown,ctx:Context) {
    let connection:ReturnType<typeof openPostgres>|undefined;
    const getDatabase=()=>{
      if(!connection)connection=openPostgres(process.env.DATABASE_URL!,{expectedMigrations});
      return connection.db;
    };
    let response:Response;
    try {
      if(process.env.TRACKER_AUTH_MODE!=='supabase'||!process.env.TRACKER_SESSION_SECRET||process.env.TRACKER_SESSION_SECRET.length<32)throw Error('Backend configuration missing');
      response=await withRequestDatabase(getDatabase,async()=>{
        const path=new URL(request.url).pathname;
        if(path==='/api/health') {
          const available=process.env.REPLICA_ENABLED!=='false';
          return Response.json({status:available?'ok':'unavailable',replica:process.env.REPLICA_ID},{status:available?200:503});
        }
        if(process.env.REPLICA_ENABLED==='false')return new Response('Replica unavailable',{status:503});
        if(path==='/api/ready') {
          await getDatabase().prepare('SELECT 1').bind().first();
          return Response.json({status:'ok',replica:process.env.REPLICA_ID});
        }
        const route=routes[path];
        if(!route)return new Response('Not found',{status:404});
        const handler=route[request.method];
        return handler?handler(request):new Response('Method not allowed',{status:405,headers:{Allow:Object.keys(route).join(', ')}});
      });
    }catch {
      console.error('Tracker backend request failed. Check configuration, database connectivity and migrations.');
      response=Response.json({error:'Tracker temporarily unavailable.'},{status:503});
    }finally{if(connection)ctx.waitUntil(connection.close());}
    const result=new Response(response.body,response);
    result.headers.set('Cache-Control','no-store');
    result.headers.set('X-Tracker-Replica',process.env.REPLICA_ID||'unknown');
    result.headers.set('X-Content-Type-Options','nosniff');result.headers.set('X-Frame-Options','DENY');
    result.headers.set('Strict-Transport-Security','max-age=31536000');
    if(!result.headers.has('Referrer-Policy'))result.headers.set('Referrer-Policy','no-referrer');
    return result;
  }
};
