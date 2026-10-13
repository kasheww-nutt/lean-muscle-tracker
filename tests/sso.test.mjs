import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync,sign} from 'node:crypto';
import {CognitoJwtVerifier} from 'aws-jwt-verify';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')&&!/\.[a-z]+$/.test(specifier)){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(url)))return next(url.href,context);}return next(specifier,context);}});
const {verifyIdentity,callback}=await import('../backend/api/sso.ts');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const userPoolId='us-east-1_Synthetic';const clientId='synthetic-client';
const verifier=CognitoJwtVerifier.create({userPoolId,clientId,tokenUse:'id'});
verifier.cacheJwks({keys:[{...publicKey.export({format:'jwk'}),kid:'synthetic-key',use:'sig',alg:'RS256'}]});
const payload={iss:'https://cognito-idp.us-east-1.amazonaws.com/'+userPoolId,aud:clientId,sub:'synthetic-owner',token_use:'id',exp:Math.floor(Date.now()/1000)+60,iat:Math.floor(Date.now()/1000),nonce:'synthetic-nonce'};
function jwt(overrides={}) {const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'synthetic-key'})).toString('base64url');const body=Buffer.from(JSON.stringify({...payload,...overrides})).toString('base64url');const data=header+'.'+body;return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');}
process.env.COGNITO_OWNER_SUB='synthetic-owner';
test('SSO validates signed Cognito identity, owner, nonce, audience, token use and expiry',async()=>{
 assert.equal((await verifyIdentity(jwt(),'synthetic-nonce',verifier)).sub,'synthetic-owner');
 for(const overrides of [{sub:'different-user'},{nonce:'wrong'},{aud:'different-client'},{token_use:'access'},{exp:0}])await assert.rejects(()=>verifyIdentity(jwt(overrides),'synthetic-nonce',verifier));
 const forged=jwt().split('.');forged[1]=Buffer.from(JSON.stringify({...payload,sub:'forged'})).toString('base64url');await assert.rejects(()=>verifyIdentity(forged.join('.'),'synthetic-nonce',verifier));
 assert.equal((await callback(new Request('https://tracker.example.test/sso/callback?state=forged&code=forged'))).status,401);
});
test('Account-mode SSO verifies any pool user only with a matching nonce and verified email',async()=>{
 process.env.TRACKER_AUTH_MODE='cognito';
 try {
  assert.equal((await verifyIdentity(jwt({sub:'other-account',email_verified:true}),'synthetic-nonce',verifier)).sub,'other-account');
  for(const overrides of [{sub:'other-account',email_verified:false},{sub:'other-account'},{sub:'other-account',email_verified:true,nonce:'wrong'},{sub:'other-account',email_verified:true,aud:'other-client'},{sub:'other-account',email_verified:true,exp:0}]) await assert.rejects(()=>verifyIdentity(jwt(overrides),'synthetic-nonce',verifier));
 } finally {delete process.env.TRACKER_AUTH_MODE;}
});
