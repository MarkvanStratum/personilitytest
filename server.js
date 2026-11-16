import express from 'express';
const app = express();
const BASE = 'https://personality.fyi/api/v1';
const PORT = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
app.use(express.json({limit:'12kb'}));
app.use(express.static('public', {extensions:['html']}));
async function upstream(path, options={}) {
  const response = await fetch(BASE+path, { ...options, headers:{'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{})}, signal:AbortSignal.timeout(12000) });
  const type = response.headers.get('content-type') || '';
  if(!response.ok || !type.includes('json')) throw new Error('Personality service unavailable ('+response.status+')');
  return response.json();
}
app.get('/api/questions', async (req,res)=>{
  try {
    const data = await upstream('/test/items');
    if(!Array.isArray(data.items) || data.items.length!==32) throw new Error('Unexpected question format');
    res.json({items:data.items.map(({id,statement,axis,agreePole,disagreePole})=>({id,statement,axis,agreePole,disagreePole})),count:32});
  } catch(e) {res.status(502).json({error:e.message});}
});
app.post('/api/score', async (req,res)=>{
  const answers = req.body?.answers;
  if(!Array.isArray(answers)||answers.length!==32||!answers.every(n=>Number.isInteger(n)&&n>=1&&n<=5)) return res.status(400).json({error:'Exactly 32 answers between 1 and 5 are required.'});
  try {
    const score=await upstream('/test/score',{method:'POST',body:JSON.stringify({answers})});
    const code=score.type;
    if(typeof code!=='string'||!/^[IE][NS][TF][JP]$/.test(code)) throw new Error('Unexpected scoring response');
    const profile=await upstream('/types/'+code);
    res.json({score,profile});
  } catch(e) {res.status(502).json({error:e.message});}
});
app.get('/health', (req,res)=>res.json({ok:true}));
app.listen(PORT,'0.0.0.0',()=>console.log('Personality website listening on '+PORT));
