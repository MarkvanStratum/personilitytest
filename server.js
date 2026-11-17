import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import cookieParser from 'cookie-parser';
import Stripe from 'stripe';
import pg from 'pg';
import {fileURLToPath} from 'node:url';
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
const root=path.dirname(fileURLToPath(import.meta.url));
const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY):null;
const db=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='disable'?false:{rejectUnauthorized:true}}):null;
const BASE='https://personality.fyi/api/v1';
const PLANS={starter:{amount:2295,name:'Personality Report'},premium:{amount:3795,name:'Personal Growth Plus'}};
const PLAN_ALIASES={'2295':'starter','3795':'premium',ultimate:'premium'};
const normalizePlan=p=>PLAN_ALIASES[String(p||'')]||String(p||'');
const checkoutFile='xo-dif-al1.html';
// External pages may be added without a fixed count. Each must be deployed under public/.
// External products are priced server-side, never from query parameters or HTML.
const EXTERNAL_OFFERS = {
  'xo-dif-za1-999.html': {amount:3200,currency:'zar',label:'R32',name:'External digital offer'},
  'xo-dif-al1.html': {amount:3795,currency:'gbp',label:'£37.95 GBP',name:'Personality Growth Plus'}
};
// Optional JSON map of additional filenames to {amount,currency,label,name}; no numerical limit.
if(process.env.EXTERNAL_CHECKOUT_OFFERS_JSON){
  const custom=JSON.parse(process.env.EXTERNAL_CHECKOUT_OFFERS_JSON);
  for(const [filename,offer] of Object.entries(custom)){
    if(!/^[a-zA-Z0-9_-]+\.html$/.test(filename)||!Number.isSafeInteger(offer.amount)||offer.amount<1||!/^[a-z]{3}$/.test(offer.currency)||typeof offer.label!=='string'||!offer.label.trim()||typeof offer.name!=='string'||!offer.name.trim())throw Error('Invalid external offer config: '+filename);
    EXTERNAL_OFFERS[filename]=offer;
  }
}
const externalCookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:30*60*1000};
function validTemplate(x){return typeof x==='string'&&/^[a-zA-Z0-9_-]+\.html$/.test(x)}
async function templateExists(filename){try{const st=await fs.stat(path.join(root,'public',filename));return st.isFile()}catch{return false}}
function externalOffer(filename){return EXTERNAL_OFFERS[filename]||null}
function externalSession(req){return typeof req.cookies.external_checkout_session==='string'&&/^[a-f0-9]{64}$/.test(req.cookies.external_checkout_session)?req.cookies.external_checkout_session:null}

const cookieOpts={httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:1000*60*60*24*30};
const token=()=>crypto.randomBytes(32).toString('hex');const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const cleanId=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
async function query(sql,args=[]){if(!db)throw Error('DATABASE_URL is required');return db.query(sql,args)}
async function init(){if(!db){console.warn('DATABASE_URL missing; scoring and paid access unavailable');return;}await query(`CREATE TABLE IF NOT EXISTS assessments(id uuid PRIMARY KEY, access_hash text UNIQUE NOT NULL, type varchar(4) NOT NULL, score jsonb NOT NULL, profile jsonb NOT NULL, created_at timestamptz DEFAULT now())`);await query(`CREATE TABLE IF NOT EXISTS purchases(id uuid PRIMARY KEY, assessment_id uuid REFERENCES assessments(id), plan text NOT NULL, status text NOT NULL DEFAULT 'pending', stripe_intent text UNIQUE, email text, created_at timestamptz DEFAULT now())`);await query(`CREATE TABLE IF NOT EXISTS external_checkout_orders(id uuid PRIMARY KEY,checkout_token text NOT NULL,template text NOT NULL,amount integer NOT NULL,currency text NOT NULL,stripe_intent text UNIQUE,status text NOT NULL DEFAULT 'creating',email text,created_at timestamptz DEFAULT now())`);await query(`CREATE TABLE IF NOT EXISTS personality_checkout_links(token text PRIMARY KEY,assessment_id uuid NOT NULL REFERENCES assessments(id),plan text NOT NULL,step2_file text NOT NULL,source_page text,original_query_string text,affiliate_ref text,expires_at timestamptz NOT NULL,created_at timestamptz DEFAULT now())`);await query('ALTER TABLE personality_checkout_links ALTER COLUMN assessment_id DROP NOT NULL');}
// Webhook must receive raw bytes before JSON middleware.
app.post('/api/stripe/webhook',express.raw({type:'application/json'}),async(req,res)=>{if(!stripe||!process.env.STRIPE_WEBHOOK_SECRET)return res.status(503).send('Not configured');let ev;try{ev=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET)}catch{return res.status(400).send('Invalid signature')}
 try{if(ev.type==='payment_intent.succeeded'){const intent=ev.data.object;await finalizePayment(intent)}if(ev.type==='payment_intent.payment_failed'||ev.type==='payment_intent.canceled'){const status=ev.type.endsWith('canceled')?'canceled':'failed';await query("UPDATE purchases SET status=$2 WHERE stripe_intent=$1 AND status='pending'",[ev.data.object.id,status]);await query("UPDATE external_checkout_orders SET status=$2 WHERE stripe_intent=$1 AND status='pending'",[ev.data.object.id,status])}res.json({received:true})}catch(e){console.error(e);res.status(500).send('Retry later')}});
async function finalizePayment(intent){
 if(intent.status!=='succeeded')return;
 const ref=intent.metadata?.reference;
 if(!cleanId(ref))throw Error('Missing payment reference');
 const r=await query('SELECT * FROM purchases WHERE id=$1 AND stripe_intent=$2',[ref,intent.id]);
 if(!r.rowCount)throw Error('Unknown payment');
 const purchase=r.rows[0];
 if(String(purchase.assessment_id)!==intent.metadata?.assessmentId||purchase.plan!==intent.metadata?.plan||intent.amount!==PLANS[purchase.plan]?.amount||intent.currency!=='gbp')throw Error('Payment verification mismatch');
 await query("UPDATE purchases SET status='paid' WHERE id=$1 AND status IN ('pending','creating')",[ref]);
}
app.use(express.json({limit:'24kb'}));app.use(cookieParser());
async function upstream(p,opts={}){const r=await fetch(BASE+p,{...opts,headers:{Accept:'application/json',...(opts.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(12000)});if(!r.ok||!r.headers.get('content-type')?.includes('json'))throw Error('Assessment provider unavailable');return r.json()}
app.get('/api/questions',async(req,res)=>{try{const d=await upstream('/test/items');if(!Array.isArray(d.items)||d.items.length!==32)throw Error('Unexpected questions');res.json({items:d.items.map(({id,statement,axis,agreePole,disagreePole})=>({id,statement,axis,agreePole,disagreePole})),count:32})}catch(e){res.status(502).json({error:e.message})}});
app.post('/api/score',async(req,res)=>{const a=req.body?.answers;if(!Array.isArray(a)||a.length!==32||!a.every(n=>Number.isInteger(n)&&n>=1&&n<=5))return res.status(400).json({error:'32 answers from 1–5 required'});try{const score=await upstream('/test/score',{method:'POST',body:JSON.stringify({answers:a})});if(!/^[IE][NS][TF][JP]$/.test(score.type))throw Error('Invalid scoring response');const profile=await upstream('/types/'+score.type);const id=crypto.randomUUID(),secret=token();await query('INSERT INTO assessments(id,access_hash,type,score,profile) VALUES($1,$2,$3,$4,$5)',[id,hash(secret),score.type,score,profile]);res.cookie('assessment_access',secret,cookieOpts);res.json({id,type:score.type})}catch(e){console.error(e);res.status(502).json({error:'Unable to save assessment. Check database and provider.'})}});
async function assessment(req,res,next){try{const secret=req.cookies.assessment_access;if(!cleanId(req.params.id)||typeof secret!=='string')return res.status(403).json({error:'Your assessment access is missing. Please retake the test.'});const r=await query('SELECT * FROM assessments WHERE id=$1 AND access_hash=$2',[req.params.id,hash(secret)]);if(!r.rowCount)return res.status(403).json({error:'Assessment access denied'});req.assessment=r.rows[0];next()}catch(e){next(e)}}
async function paid(id){const r=await query("SELECT plan FROM purchases WHERE assessment_id=$1 AND status='paid'",[id]);return {starter:r.rows.some(x=>['starter','premium'].includes(x.plan)),premium:r.rows.some(x=>x.plan==='premium')}}
function admin(req){const secret=process.env.ADMIN_PREVIEW_SECRET;return !!(secret&&secret.length>=20&&req.headers['x-admin-preview']&&crypto.timingSafeEqual(Buffer.from(hash(String(req.headers['x-admin-preview']))),Buffer.from(hash(secret))))}
app.get('/api/assessment/:id',assessment,async(req,res,next)=>{try{const a=req.assessment;res.json({id:a.id,type:a.type,score:a.score,profile:a.profile,entitlements:await paid(a.id)})}catch(e){next(e)}});
app.get('/api/report/:id',assessment,async(req,res,next)=>{try{const ent=await paid(req.assessment.id);const preview=admin(req);if(!ent.starter&&!preview)return res.status(402).json({error:'Purchase required'});res.json({type:req.assessment.type,tier:ent.premium||preview?'premium':'starter',preview:preview&&!ent.starter})}catch(e){next(e)}});
app.get('/api/plans',(_req,res)=>res.json({currency:'GBP',checkout_enabled:!!stripe,plans:Object.entries(PLANS).map(([id,x])=>({id,name:x.name,price_pence:x.amount,available:true}))}));
app.get('/api/stripe/config',(_req,res)=>{if(!process.env.STRIPE_PUBLISHABLE_KEY)return res.status(503).json({error:'Stripe not configured'});res.json({publishableKey:process.env.STRIPE_PUBLISHABLE_KEY})});
// External checkout contract is unchanged: /c/:token injects the token only.
async function checkoutAssessment(req){
 const secret=req.cookies.assessment_access;
 if(!secret)return null;
 const r=await query('SELECT id FROM assessments WHERE access_hash=$1 ORDER BY created_at DESC LIMIT 1',[hash(secret)]);
 return r.rows[0]?.id||null;
}
async function checkoutLink(token,req){
 if(!/^[A-Za-z0-9_-]{24}$/.test(token))return null;
 const r=await query('SELECT * FROM personality_checkout_links WHERE token=$1 AND expires_at>NOW()',[token]);
 if(!r.rowCount)return null;
 const link=r.rows[0];
 if(link.assessment_id){if((await checkoutAssessment(req))!==link.assessment_id)return null;}
 else {const sess=externalSession(req);if(!sess||link.affiliate_ref!==hash(sess))return null;}
 return link;
}
app.post('/api/create-promo-checkout-link',async(req,res)=>{try{
 const step2File=String(req.body?.step2File||checkoutFile);
 if(!validTemplate(step2File)||!await templateExists(step2File))return res.status(400).json({error:'Checkout template not available'});
 const plan=normalizePlan(req.body?.plan);
 if(!PLANS[plan])return res.status(400).json({error:'Invalid plan'});
 const id=await checkoutAssessment(req);
 // Website checkout remains assessment-bound. External templates are standalone.
 const isWebsite=step2File===checkoutFile&&!!id;
 if(isWebsite&&plan==='premium'&&process.env.CONSULTATION_ENABLED!=='true')return res.status(409).json({error:'Growth Plus consultations are not available yet'});
 if(!isWebsite&&!externalOffer(step2File))return res.status(400).json({error:'External offer is not configured for this template'});
 let sess=externalSession(req);
 if(!isWebsite&&!sess){sess=token();res.cookie('external_checkout_session',sess,externalCookieOptions)}
 const checkoutToken=crypto.randomBytes(18).toString('base64url');
 const affiliateRef=isWebsite?String(req.body?.ref||'').slice(0,255):hash(sess);
 await query(`INSERT INTO personality_checkout_links(token,assessment_id,plan,step2_file,source_page,original_query_string,affiliate_ref,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()+INTERVAL '30 minutes')`,[checkoutToken,isWebsite?id:null,plan,step2File,String(req.body?.sourcePage||'').slice(0,1000),String(req.body?.originalQueryString||'').slice(0,3000),affiliateRef]);
 res.set('Cache-Control','no-store');res.json({url:'/c/'+checkoutToken});
 }catch(e){console.error('Checkout link creation failed',e);res.status(500).json({error:'Unable to create checkout link'})}});
app.get('/c/:token',async(req,res)=>{try{
 const link=await checkoutLink(req.params.token,req);
 if(!link)return res.status(404).send('Checkout expired or unavailable');
 let html=await fs.readFile(path.join(root,'public',link.step2_file),'utf8');
 const bootstrap='<script>window.PROMO_CHECKOUT_TOKEN='+JSON.stringify(req.params.token)+'</script>';
 html=html.replace(/<head\b[^>]*>/i,m=>m+bootstrap);
 res.set('Cache-Control','no-store');res.set('X-Robots-Tag','noindex, nofollow');res.type('html').send(html);
 }catch(e){console.error(e);res.status(500).send('Checkout unavailable')}});
app.get('/api/checkout-link/:token',async(req,res)=>{try{
 const link=await checkoutLink(req.params.token,req);
 if(!link)return res.status(404).json({error:'Checkout link expired or unavailable'});
 const isExternal=!link.assessment_id;
 const offer=isExternal?externalOffer(link.step2_file):null;
 if(isExternal&&!offer)return res.status(409).json({error:'External offer unavailable'});
 res.set('Cache-Control','no-store');
 res.json({plan:link.plan==='premium'?'ultimate':'starter',step2File:link.step2_file,external:isExternal,amount:offer?.amount??PLANS[link.plan].amount,currency:offer?.currency??'gbp',displayPrice:offer?.label??(PLANS[link.plan].amount/100).toFixed(2)+' GBP',assessmentId:link.assessment_id||null});
 }catch(e){console.error(e);res.status(500).json({error:'Checkout unavailable'})}});
app.post('/api/stripe/create-payment-intent',async(req,res)=>{try{
 if(!stripe||!process.env.STRIPE_WEBHOOK_SECRET||!process.env.STRIPE_PUBLISHABLE_KEY)return res.status(503).json({error:'Stripe is not configured'});
 const plan=normalizePlan(req.body?.plan);
 if(!PLANS[plan])return res.status(400).json({error:'Invalid plan'});
 const checkoutToken=String(req.body?.checkoutToken||'');
 const link=checkoutToken?await checkoutLink(checkoutToken,req):null;
 if(checkoutToken&&!link)return res.status(403).json({error:'Checkout session expired'});
 if(link&&!link.assessment_id){
   if(link.plan!==plan)return res.status(400).json({error:'Invalid plan for checkout'});
   const offer=externalOffer(link.step2_file);
   if(!offer)return res.status(409).json({error:'External offer unavailable'});
   const reference=crypto.randomUUID();
   await query('INSERT INTO external_checkout_orders(id,checkout_token,template,amount,currency,status) VALUES($1,$2,$3,$4,$5,$6)',[reference,checkoutToken,link.step2_file,offer.amount,offer.currency,'creating']);
   const intent=await stripe.paymentIntents.create({amount:offer.amount,currency:offer.currency,payment_method_types:['card'],metadata:{flow:'external',reference,checkoutToken,template:link.step2_file},description:offer.name},{idempotencyKey:reference});
   await query("UPDATE external_checkout_orders SET stripe_intent=$1,status='pending' WHERE id=$2 AND status='creating'",[intent.id,reference]);
   res.set('Cache-Control','no-store');return res.json({clientSecret:intent.client_secret,reference});
 }
 if(plan==='premium'&&process.env.CONSULTATION_ENABLED!=='true')return res.status(409).json({error:'Growth Plus consultations are not available yet'});
 const id=await checkoutAssessment(req);
 if(!id)return res.status(403).json({error:'Assessment access denied'});
 if(link&&(link.assessment_id!==id||link.plan!==plan))return res.status(403).json({error:'Checkout assessment mismatch'});
 const ent=await paid(id);
 if((plan==='starter'&&ent.starter)||(plan==='premium'&&ent.premium))return res.status(409).json({error:'Already purchased'});
 const reference=crypto.randomUUID();
 await query('INSERT INTO purchases(id,assessment_id,plan,status) VALUES($1,$2,$3,$4)',[reference,id,plan,'creating']);
 const intent=await stripe.paymentIntents.create({amount:PLANS[plan].amount,currency:'gbp',payment_method_types:['card'],metadata:{reference,assessmentId:id,plan},description:'Personality Discovery — '+PLANS[plan].name},{idempotencyKey:reference});
 await query("UPDATE purchases SET stripe_intent=$1,status='pending' WHERE id=$2 AND status='creating'",[intent.id,reference]);
 res.set('Cache-Control','no-store');res.json({clientSecret:intent.client_secret,reference});
 }catch(e){console.error('Payment creation failed',e);res.status(500).json({error:'Unable to create payment'})}});
app.get('/api/stripe/payment-status',async(req,res)=>{try{
 const reference=String(req.query.reference||'');
 if(!cleanId(reference))return res.status(400).json({error:'Invalid payment reference'});
 const external=await query('SELECT status,stripe_intent,checkout_token FROM external_checkout_orders WHERE id=$1',[reference]);
 if(external.rowCount){
   const checkoutToken=String(req.query.checkoutToken||'');
   if(!checkoutToken||external.rows[0].checkout_token!==checkoutToken||!await checkoutLink(checkoutToken,req))return res.status(403).json({error:'Checkout session expired'});
   let {status,stripe_intent}=external.rows[0];
   if(status!=='paid'&&stripe_intent&&stripe){const intent=await stripe.paymentIntents.retrieve(stripe_intent);if(intent.status==='succeeded'){await finalizePayment(intent);status='paid'}}
   res.set('Cache-Control','no-store');return res.json({status});
 }
 const id=await checkoutAssessment(req);
 if(!id)return res.status(403).json({error:'Assessment access denied'});
 const r=await query('SELECT status,stripe_intent,plan FROM purchases WHERE id=$1 AND assessment_id=$2',[reference,id]);
 if(!r.rowCount)return res.status(404).json({error:'Payment not found'});
 let {status,stripe_intent,plan}=r.rows[0];
 if(status!=='paid'&&stripe_intent&&stripe){const intent=await stripe.paymentIntents.retrieve(stripe_intent);if(intent.status==='succeeded'){await finalizePayment(intent);status='paid'}}
 res.set('Cache-Control','no-store');res.json({status,plan});
 }catch(e){console.error('Payment status error',e);res.status(500).json({error:'Unable to check payment status'})}});
// Public homepage stays indexable; existing result links remain available through /results.html.
app.use('/api',(req,res,next)=>{res.set('X-Robots-Tag','noindex, nofollow');next()});app.use(express.static(path.join(root,'public'),{extensions:['html']}));app.get('/health',(_req,res)=>res.json({ok:true}));app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Server error'})});
init().then(()=>app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Personality website ready'))).catch(e=>{console.error('Database initialization failed',e);process.exit(1)});
