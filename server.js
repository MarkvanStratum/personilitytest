import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import cookieParser from 'cookie-parser';
import Stripe from 'stripe';
import pg from 'pg';
import {fileURLToPath} from 'node:url';
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
const root=path.dirname(fileURLToPath(import.meta.url));
const reportDirectory=path.join(root,'private-reports');
const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY):null;
const db=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='disable'?false:{rejectUnauthorized:true}}):null;
const BASE='https://personality.fyi/api/v1';
const PLANS={starter:{amount:2295,name:'Personality Report'},premium:{amount:3795,name:'Personal Growth Plus'}};
const PLAN_ALIASES={'2295':'starter','3795':'premium',ultimate:'premium'};
const normalizePlan=p=>PLAN_ALIASES[String(p||'')]||String(p||'');
const checkoutFile='xo-dif-al1.html';
const cookieOpts={httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:1000*60*60*24*30};
const token=()=>crypto.randomBytes(32).toString('hex');const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const cleanId=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
async function query(sql,args=[]){if(!db)throw Error('DATABASE_URL is required');return db.query(sql,args)}
async function init(){if(!db){console.warn('DATABASE_URL missing; scoring and paid access unavailable');return;}await query(`CREATE TABLE IF NOT EXISTS assessments(id uuid PRIMARY KEY, access_hash text UNIQUE NOT NULL, type varchar(4) NOT NULL, score jsonb NOT NULL, profile jsonb NOT NULL, created_at timestamptz DEFAULT now())`);await query(`CREATE TABLE IF NOT EXISTS purchases(id uuid PRIMARY KEY, assessment_id uuid REFERENCES assessments(id), plan text NOT NULL, status text NOT NULL DEFAULT 'pending', stripe_intent text UNIQUE, email text, created_at timestamptz DEFAULT now())`);await query(`CREATE TABLE IF NOT EXISTS personality_checkout_links(token text PRIMARY KEY,assessment_id uuid NOT NULL REFERENCES assessments(id),plan text NOT NULL,step2_file text NOT NULL,source_page text,original_query_string text,affiliate_ref text,expires_at timestamptz NOT NULL,created_at timestamptz DEFAULT now())`);await query(`CREATE TABLE IF NOT EXISTS customer_accounts(id uuid PRIMARY KEY,email text UNIQUE NOT NULL,password_hash text NOT NULL,created_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS customer_sessions(token_hash text PRIMARY KEY,account_id uuid NOT NULL REFERENCES customer_accounts(id),expires_at timestamptz NOT NULL); ALTER TABLE assessments ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES customer_accounts(id); ALTER TABLE purchases ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES customer_accounts(id);`);}
// Webhook must receive raw bytes before JSON middleware.
app.post('/api/stripe/webhook',express.raw({type:'application/json'}),async(req,res)=>{if(!stripe||!process.env.STRIPE_WEBHOOK_SECRET)return res.status(503).send('Not configured');let ev;try{ev=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET)}catch{return res.status(400).send('Invalid signature')}
 try{if(ev.type==='payment_intent.succeeded'){const intent=ev.data.object;await finalizePayment(intent)}if(ev.type==='payment_intent.payment_failed'||ev.type==='payment_intent.canceled'){await query("UPDATE purchases SET status=$2 WHERE stripe_intent=$1 AND status='pending'",[ev.data.object.id,ev.type.endsWith('canceled')?'canceled':'failed'])}res.json({received:true})}catch(e){console.error(e);res.status(500).send('Retry later')}});
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
const derive=(password,salt)=>new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(e,key)=>e?reject(e):resolve(key.toString('hex'))));
async function customer(req){const t=req.cookies.customer_session;if(typeof t!=='string'||!/^[a-f0-9]{64}$/.test(t))return null;const r=await query('SELECT a.id,a.email FROM customer_sessions s JOIN customer_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now()',[hash(t)]);return r.rows[0]||null;}
async function requireCustomer(req,res,next){try{req.customer=await customer(req);if(!req.customer)return res.status(401).json({error:'Please register or log in before paying'});next()}catch(e){next(e)}}
function sameOrigin(req,res,next){if(req.get('sec-fetch-site')==='cross-site'||(req.get('origin')&&new URL(req.get('origin')).host!==req.get('host')))return res.status(403).json({error:'Invalid origin'});next()}
const attempts=new Map();function limitAuth(req,res,next){const now=Date.now();for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);const k=req.ip;const v=attempts.get(k)||{count:0,until:now+900000};if(++v.count>15)return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});attempts.set(k,v);next()}
async function signIn(req,res,account){const secret=req.cookies.assessment_access;if(typeof secret==='string')await query('UPDATE assessments SET account_id=$1 WHERE access_hash=$2 AND account_id IS NULL',[account.id,hash(secret)]);if(req.cookies.customer_session)await query('DELETE FROM customer_sessions WHERE token_hash=$1',[hash(String(req.cookies.customer_session))]);const t=token();await query("INSERT INTO customer_sessions VALUES($1,$2,now()+interval '30 days')",[hash(t),account.id]);res.cookie('customer_session',t,cookieOpts);res.json({email:account.email});}
app.post('/api/account/:action',sameOrigin,limitAuth,async(req,res,next)=>{try{const email=String(req.body?.email||'').trim().toLowerCase(),password=req.body?.password;if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof password!=='string'||password.length<8||password.length>128)return res.status(400).json({error:'Enter a valid email and a password of 8–128 characters.'});let account;if(req.params.action==='register'){const salt=token(),key=await derive(password,salt);const r=await query('INSERT INTO customer_accounts(id,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id,email',[crypto.randomUUID(),email,salt+':'+key]);if(!r.rowCount)return res.status(409).json({error:'Account already exists. Please log in.'});account=r.rows[0];}else if(req.params.action==='login'){const r=await query('SELECT * FROM customer_accounts WHERE email=$1',[email]);account=r.rows[0];const [salt,key]=(account?.password_hash||'dummy:'+ '0'.repeat(128)).split(':');const actual=await derive(password,salt);if(!account||!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(key)))return res.status(401).json({error:'Incorrect email or password.'});}else return res.sendStatus(404);await signIn(req,res,account)}catch(e){next(e)}});
app.get('/api/account',requireCustomer,async(req,res,next)=>{try{const r=await query('SELECT a.id,a.type,a.created_at,EXISTS(SELECT 1 FROM purchases p WHERE p.assessment_id=a.id AND p.status=\'paid\') AS paid FROM assessments a WHERE a.account_id=$1 ORDER BY a.created_at DESC',[req.customer.id]);res.set('Cache-Control','no-store').json({email:req.customer.email,assessments:r.rows})}catch(e){next(e)}});
app.post('/api/logout',sameOrigin,async(req,res,next)=>{try{if(req.cookies.customer_session)await query('DELETE FROM customer_sessions WHERE token_hash=$1',[hash(String(req.cookies.customer_session))]);res.clearCookie('customer_session',{path:'/'});res.clearCookie('assessment_access',{path:'/'});res.json({ok:true})}catch(e){next(e)}});
async function upstream(p,opts={}){const r=await fetch(BASE+p,{...opts,headers:{Accept:'application/json',...(opts.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(12000)});if(!r.ok||!r.headers.get('content-type')?.includes('json'))throw Error('Assessment provider unavailable');return r.json()}
app.get('/api/questions',async(req,res)=>{try{const d=await upstream('/test/items');if(!Array.isArray(d.items)||d.items.length!==32)throw Error('Unexpected questions');res.json({items:d.items.map(({id,statement,axis,agreePole,disagreePole})=>({id,statement,axis,agreePole,disagreePole})),count:32})}catch(e){res.status(502).json({error:e.message})}});
app.post('/api/score',async(req,res)=>{const a=req.body?.answers;if(!Array.isArray(a)||a.length!==32||!a.every(n=>Number.isInteger(n)&&n>=1&&n<=5))return res.status(400).json({error:'32 answers from 1–5 required'});try{const score=await upstream('/test/score',{method:'POST',body:JSON.stringify({answers:a})});if(!/^[IE][NS][TF][JP]$/.test(score.type))throw Error('Invalid scoring response');const profile=await upstream('/types/'+score.type);const id=crypto.randomUUID(),secret=token();await query('INSERT INTO assessments(id,access_hash,type,score,profile,account_id) VALUES($1,$2,$3,$4,$5,$6)',[id,hash(secret),score.type,score,profile,(await customer(req))?.id||null]);res.cookie('assessment_access',secret,cookieOpts);res.json({id,type:score.type})}catch(e){console.error(e);res.status(502).json({error:'Unable to save assessment. Check database and provider.'})}});
async function assessment(req,res,next){try{const secret=req.cookies.assessment_access,account=await customer(req);if(!cleanId(req.params.id))return res.status(403).json({error:'Assessment access denied'});const r=await query('SELECT * FROM assessments WHERE id=$1 AND (account_id=$2 OR (account_id IS NULL AND access_hash=$3))',[req.params.id,account?.id||null,typeof secret==='string'?hash(secret):null]);if(!r.rowCount)return res.status(403).json({error:'Assessment access denied. Please log in.'});req.assessment=r.rows[0];if(account&&req.assessment.account_id===account.id&&req.path.startsWith('/api/assessment/')&&(!secret||hash(secret)!==req.assessment.access_hash)){const fresh=token();await query('UPDATE assessments SET access_hash=$1 WHERE id=$2 AND account_id=$3',[hash(fresh),req.assessment.id,account.id]);res.cookie('assessment_access',fresh,cookieOpts);}next()}catch(e){next(e)}}
async function paid(id){const r=await query("SELECT plan FROM purchases WHERE assessment_id=$1 AND status='paid'",[id]);return {starter:r.rows.some(x=>['starter','premium'].includes(x.plan)),premium:r.rows.some(x=>x.plan==='premium')}}
function admin(req){const secret=process.env.ADMIN_PREVIEW_SECRET;return !!(secret&&secret.length>=20&&req.headers['x-admin-preview']&&crypto.timingSafeEqual(Buffer.from(hash(String(req.headers['x-admin-preview']))),Buffer.from(hash(secret))))}
app.get('/api/assessment/:id',assessment,async(req,res,next)=>{try{const a=req.assessment;res.json({id:a.id,type:a.type,score:a.score,profile:a.profile,entitlements:await paid(a.id)})}catch(e){next(e)}});
app.get('/api/report/:id',assessment,async(req,res,next)=>{try{const ent=await paid(req.assessment.id);const preview=admin(req);res.set('Cache-Control','private, no-store');if(!ent.starter&&!preview)return res.status(402).json({error:'Purchase required'});res.json({type:req.assessment.type,tier:ent.premium||preview?'premium':'starter',preview:preview&&!ent.starter,url:'/report/'+req.assessment.id})}catch(e){next(e)}});
app.get('/report/:id',assessment,async(req,res,next)=>{try{res.set({'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'});const ent=await paid(req.assessment.id);if(!ent.starter&&!admin(req))return res.status(402).send('Purchase required');const type=req.assessment.type;if(!/^[IE][NS][TF][JP]$/.test(type))return res.sendStatus(404);res.sendFile(type.toLowerCase()+'.html',{root:reportDirectory,cacheControl:false},err=>{if(err)next(err)})}catch(e){next(e)}});
app.get('/api/plans',(_req,res)=>res.json({currency:'GBP',checkout_enabled:!!stripe,plans:Object.entries(PLANS).map(([id,x])=>({id,name:x.name,price_pence:x.amount,available:true}))}));
app.get('/api/stripe/config',(_req,res)=>{if(!process.env.STRIPE_PUBLISHABLE_KEY)return res.status(503).json({error:'Stripe not configured'});res.json({publishableKey:process.env.STRIPE_PUBLISHABLE_KEY})});
// External checkout contract is unchanged: /c/:token injects the token only.
async function checkoutAssessment(req){
 const secret=req.cookies.assessment_access;
 if(!secret)return null;
 const account=await customer(req);const r=await query('SELECT id FROM assessments WHERE access_hash=$1 AND (account_id IS NULL OR account_id=$2) LIMIT 1',[hash(secret),account?.id||null]);
 return r.rows[0]?.id||null;
}
async function checkoutLink(token,req){
 if(!/^[A-Za-z0-9_-]{24}$/.test(token))return null;
 const r=await query('SELECT * FROM personality_checkout_links WHERE token=$1 AND expires_at>NOW()',[token]);
 if(!r.rowCount)return null;
 const link=r.rows[0];
 if((await checkoutAssessment(req))!==link.assessment_id)return null;
 return link;
}
app.post('/api/create-promo-checkout-link',async(req,res)=>{try{
 const plan=normalizePlan(req.body?.plan);
 if(!PLANS[plan])return res.status(400).json({error:'Invalid plan'});
 if(plan==='premium'&&process.env.CONSULTATION_ENABLED!=='true')return res.status(409).json({error:'Growth Plus consultations are not available yet'});
 const id=await checkoutAssessment(req);
 if(!id)return res.status(403).json({error:'Complete your assessment first'});
 const step2File=String(req.body?.step2File||checkoutFile);
 if(step2File!==checkoutFile)return res.status(400).json({error:'Checkout template not available'});
 const checkoutToken=crypto.randomBytes(18).toString('base64url');
 await query(`INSERT INTO personality_checkout_links(token,assessment_id,plan,step2_file,source_page,original_query_string,affiliate_ref,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()+INTERVAL '30 minutes')`,[checkoutToken,id,plan,step2File,String(req.body?.sourcePage||'').slice(0,1000),String(req.body?.originalQueryString||'').slice(0,3000),String(req.body?.ref||'').slice(0,255)]);
 res.set('Cache-Control','no-store');res.json({url:'/c/'+checkoutToken});
 }catch(e){console.error('Checkout link creation failed',e);res.status(500).json({error:'Unable to create checkout link'})}});
app.get('/c/:token',async(req,res)=>{try{
 const link=await checkoutLink(req.params.token,req);
 if(!link)return res.status(404).send('Checkout expired or unavailable');
  if(!await customer(req))return res.redirect('/account.html?next='+encodeURIComponent(req.originalUrl));
 let html=await (await import('node:fs/promises')).readFile(path.join(root,'public',checkoutFile),'utf8');
 const bootstrap='<script>window.PROMO_CHECKOUT_TOKEN='+JSON.stringify(req.params.token)+'</script>';
 html=html.replace(/<head\b[^>]*>/i,m=>m+bootstrap);
 res.set('Cache-Control','no-store');res.set('X-Robots-Tag','noindex, nofollow');res.type('html').send(html);
 }catch(e){console.error(e);res.status(500).send('Checkout unavailable')}});
app.get('/api/checkout-link/:token',requireCustomer,async(req,res)=>{try{
 const link=await checkoutLink(req.params.token,req);
 if(!link)return res.status(404).json({error:'Checkout link expired or unavailable'});
 res.set('Cache-Control','no-store');
 // Original checkout expects ultimate for the 3795 legacy plan.
 res.json({plan:link.plan==='premium'?'ultimate':'starter',step2File:link.step2_file,assessmentId:link.assessment_id,email:req.customer.email});
 }catch(e){console.error(e);res.status(500).json({error:'Checkout unavailable'})}});
app.post('/api/stripe/create-payment-intent',sameOrigin,requireCustomer,async(req,res)=>{try{
 if(!stripe||!process.env.STRIPE_WEBHOOK_SECRET||!process.env.STRIPE_PUBLISHABLE_KEY)return res.status(503).json({error:'Stripe is not configured'});
 const plan=normalizePlan(req.body?.plan);
 if(!PLANS[plan])return res.status(400).json({error:'Invalid plan'});
 if(plan==='premium'&&process.env.CONSULTATION_ENABLED!=='true')return res.status(409).json({error:'Growth Plus consultations are not available yet'});
 const id=await checkoutAssessment(req);
 if(!id)return res.status(403).json({error:'Assessment access denied'});
 const owned=await query('UPDATE assessments SET account_id=$2 WHERE id=$1 AND (account_id IS NULL OR account_id=$2) RETURNING id',[id,req.customer.id]);if(!owned.rowCount)return res.status(403).json({error:'Assessment access denied'});
  const ent=await paid(id);
 if((plan==='starter'&&ent.starter)||(plan==='premium'&&ent.premium))return res.status(409).json({error:'Already purchased'});
 const reference=crypto.randomUUID();
 await query('INSERT INTO purchases(id,assessment_id,plan,status,account_id,email) VALUES($1,$2,$3,$4,$5,$6)',[reference,id,plan,'creating',req.customer.id,req.customer.email]);
 const intent=await stripe.paymentIntents.create({amount:PLANS[plan].amount,currency:'gbp',payment_method_types:['card'],metadata:{reference,assessmentId:id,plan},description:'Personality Discovery — '+PLANS[plan].name},{idempotencyKey:reference});
 await query("UPDATE purchases SET stripe_intent=$1,status='pending' WHERE id=$2 AND status='creating'",[intent.id,reference]);
 res.set('Cache-Control','no-store');res.json({clientSecret:intent.client_secret,reference});
 }catch(e){console.error('Payment creation failed',e);res.status(500).json({error:'Unable to create payment'})}});
app.get('/api/stripe/payment-status',async(req,res)=>{try{
 const id=await checkoutAssessment(req);
 if(!id)return res.status(403).json({error:'Assessment access denied'});
 const reference=String(req.query.reference||'');
 if(!cleanId(reference))return res.status(400).json({error:'Invalid payment reference'});
 const r=await query('SELECT status,stripe_intent,plan FROM purchases WHERE id=$1 AND assessment_id=$2',[reference,id]);
 if(!r.rowCount)return res.status(404).json({error:'Payment not found'});
 let {status,stripe_intent,plan}=r.rows[0];
 if(status!=='paid'&&stripe_intent&&stripe){const intent=await stripe.paymentIntents.retrieve(stripe_intent);if(intent.status==='succeeded'){await finalizePayment(intent);status='paid'}}
 res.set('Cache-Control','no-store');res.json({status,plan});
 }catch(e){console.error('Payment status error',e);res.status(500).json({error:'Unable to check payment status'})}});
// Public homepage stays indexable; existing result links remain available through /results.html.
app.use('/api',(req,res,next)=>{res.set('X-Robots-Tag','noindex, nofollow');next()});app.use(express.static(path.join(root,'public'),{extensions:['html']}));app.get('/health',(_req,res)=>res.json({ok:true}));app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Server error'})});
init().then(()=>app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Personality website ready'))).catch(e=>{console.error('Database initialization failed',e);process.exit(1)});
