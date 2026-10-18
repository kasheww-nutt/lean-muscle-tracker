import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,X509Certificate} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function hyperdriveOrigin(connectionString) {
 const url=new URL(connectionString);
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.password||url.search)throw Error('Hyperdrive requires a PostgreSQL URL with credentials and no URL options.');
 return {scheme:'postgres',host:url.hostname,port:Number(url.port||5432),database:decodeURIComponent(url.pathname.slice(1)),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password)};
}

export async function configureHyperdrive({accountId,token,connectionString,ca,request=fetch}) {
 if(!/^[a-f0-9]{32}$/i.test(accountId||'')||!token||!ca)throw Error('Cloudflare account, API token and database CA are required.');
 const cert=new X509Certificate(ca);
 if(!cert.ca||Date.parse(cert.validTo)<Date.now())throw Error('The database trust certificate must be an unexpired CA.');
 const origin=hyperdriveOrigin(connectionString);
 const base='https://api.cloudflare.com/client/v4/accounts/'+accountId;
 async function api(path,method='GET',body) {
  const response=await request(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  let data;try{data=await response.json();}catch{throw Error('Cloudflare API returned invalid JSON (HTTP '+response.status+').');}
  if(!response.ok||!data.success) {
   const codes=(data.errors||[]).map(e=>Number(e.code)).filter(Number.isFinite).join(',');
   // API error messages may echo origin credentials. Never print response bodies.
   throw Error('Cloudflare setup failed at '+path.split('/')[1]+' (HTTP '+response.status+', codes '+codes+'). Ensure the token has Account Hyperdrive Edit and Account SSL and Certificates Edit.');
  }
  return data;
 }
 const name='lean-tracker-db';
 const caName='lean-tracker-ca-'+createHash('sha256').update(cert.raw).digest('hex').slice(0,16);
 let authority;
 for(let page=1;page<=100;page++) {
  const data=await api('/mtls_certificates?per_page=50&page='+page);
  authority=data.result.find(c=>c.name===caName&&c.ca);
  if(authority||data.result.length<50)break;
  if(page===100)throw Error('Certificate listing exceeded pagination limit.');
 }
 if(!authority)authority=(await api('/mtls_certificates','POST',{name:caName,ca:true,certificates:ca})).result;
 const configs=(await api('/hyperdrive/configs')).result;
 const matches=configs.filter(c=>c.name===name);
 if(matches.length>1)throw Error('More than one Hyperdrive configuration has the tracker name. Resolve the duplicate before deployment.');
 const body={name,origin,caching:{disabled:true},mtls:{ca_certificate_id:authority.id,sslmode:'verify-full'},origin_connection_limit:5};
 const result=(await api(matches.length?'/hyperdrive/configs/'+matches[0].id:'/hyperdrive/configs',matches.length?'PUT':'POST',body)).result;
 if(!/^[a-f0-9]{32}$/i.test(result.id||''))throw Error('Cloudflare did not return a valid Hyperdrive ID.');
 return result.id;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  const id=await configureHyperdrive({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN,connectionString:process.env.DATABASE_URL,ca:process.env.DATABASE_SSL_CA});
  for(const replica of ['a','b']) {
   const path='infrastructure/cloudflare/wrangler.'+replica+'.jsonc';
   const config=JSON.parse(readFileSync(path,'utf8'));
   config.hyperdrive=[{binding:'HYPERDRIVE',id}];
   writeFileSync(path,JSON.stringify(config,null,2)+'\n');
  }
  console.log('Both replicas configured for Hyperdrive with verify-full origin TLS, CA trust and query caching disabled.');
 }catch(error){console.error(error instanceof Error?error.message:'Hyperdrive setup failed.');process.exitCode=1;}
}
