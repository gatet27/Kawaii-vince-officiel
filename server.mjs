import 'dotenv/config';
import express from 'express';
import Stripe from 'stripe';
import {rateLimit} from 'express-rate-limit';
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';

const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||3000);
const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY):null;
const supabaseUrl=process.env.SUPABASE_URL||'';
const supabaseAnonKey=process.env.SUPABASE_ANON_KEY||'';
const supabase=process.env.SUPABASE_SERVICE_ROLE_KEY&&supabaseUrl?createClient(supabaseUrl,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const catalog=JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
const products=new Map(catalog.map(p=>[p.id,p]));
const allowedOrigins=(process.env.PUBLIC_ORIGIN||'').replace(/\/$/,'');
const checkoutReady=()=>stripe&&supabase&&allowedOrigins;
function bad(res,status,message){return res.status(status).json({error:message})}
function cents(value){return Math.round(Number(value)*100)}
function cartLines(cart){
 if(!Array.isArray(cart)||!cart.length||cart.length>40)throw Error('Panier vide ou trop volumineux.');
 let unitCount=0;
 return cart.map(item=>{
  if(!Number.isInteger(item.id)||!Number.isInteger(item.qty)||item.qty<1||item.qty>20)throw Error('Quantité non valide.');
  unitCount+=item.qty;if(unitCount>80)throw Error('La quantité maximale est dépassée.');
  const product=products.get(item.id);if(!product||product.price===null)throw Error('Un produit est indisponible.');
  const volume=product.group==='cremes'&&Number(item.volume)===200?200:product.group==='cremes'?100:0;
  const amount=cents(product.price)+(product.group==='cremes'&&volume===200?600:0);
  if(!Number.isInteger(amount)||amount<50)throw Error('Prix incorrect.');
  return {id:product.id,name:product.title,volume,quantity:item.qty,amount};
 });
}
const protectedText=(value,max=160)=>typeof value==='string'?value.trim().slice(0,max):'';
function cleanAddress(a){
 if(!a||typeof a!=='object')throw Error('Adresse de livraison manquante.');
 const safe={firstName:protectedText(a.firstName,80),lastName:protectedText(a.lastName,80),address1:protectedText(a.address1,180),address2:protectedText(a.address2,120),city:protectedText(a.city,110),zip:protectedText(a.zip,16),country:protectedText(a.country,2).toUpperCase(),phone:protectedText(a.phone,30)};
 if(!safe.firstName||!safe.lastName||!safe.address1||!safe.city||!safe.zip||!safe.phone||!['FR','BE','LU'].includes(safe.country))throw Error('Vérifie ton adresse de livraison.');
 return safe;
}
function fees(lines,country){const sub=lines.reduce((n,l)=>n+l.amount*l.quantity,0);return country==='FR'&&sub>=5000?0:country==='FR'?490:790}
async function stripePromo(code){
 const promo=protectedText(code,60).toUpperCase();if(!promo)return null;
 const p=await stripe.promotionCodes.list({code:promo,active:true,limit:10});
 const found=p.data.find(x=>x.active&&!x.coupon?.deleted&&(!x.expires_at||x.expires_at>Date.now()/1000)&&(!x.max_redemptions||x.times_redeemed<x.max_redemptions));
 if(!found)throw Error('Ce code promotionnel n’est pas valable.');
 return found;
}
async function userFromToken(header){if(!supabase)return null;const bearer=/^Bearer (.+)$/i.exec(header||'');if(!bearer)return null;const {data,error}=await supabase.auth.getUser(bearer[1]);if(error)return null;return data.user||null}
async function updateOrder(session,status){
 const ref=session.metadata?.order_id;if(!ref||!supabase)return;
 const changes={status,paid_at:status==='paid'?new Date().toISOString():null};if(status==='paid'&&Number.isInteger(session.amount_total))changes.total_cents=session.amount_total;const {error}=await supabase.from('orders').update(changes).eq('id',ref);
 if(error)console.error('Impossible de mettre à jour la commande',error.message);
}
// Webhook MUST read original request bytes before JSON middleware.
app.post('/api/stripe/webhook',express.raw({type:'application/json'}),async(req,res)=>{
 if(!stripe||!process.env.STRIPE_WEBHOOK_SECRET)return bad(res,503,'Webhook non configuré.');
 let event;try{event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET)}catch(err){return bad(res,400,'Signature du webhook incorrecte.');}
 try{
  if(event.type==='checkout.session.completed'&&event.data.object.payment_status==='paid')await updateOrder(event.data.object,'paid');
  if(event.type==='checkout.session.async_payment_succeeded')await updateOrder(event.data.object,'paid');
  if(event.type==='checkout.session.async_payment_failed'||event.type==='checkout.session.expired')await updateOrder(event.data.object,'failed');
  res.json({received:true});
 }catch(e){console.error(e);res.status(500).end()}
});
app.use(express.json({limit:'80kb'}));
const checkoutLimiter=rateLimit({windowMs:60_000,limit:15,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Trop de requêtes. Réessayez dans une minute.'}});
app.use('/api/checkout/start',checkoutLimiter);app.use('/api/promotions/validate',checkoutLimiter);
app.get('/api/config',(_req,res)=>{res.set('Cache-Control','no-store');res.json({supabaseUrl,supabaseAnonKey})});
app.post('/api/promotions/validate',async(req,res)=>{
 if(!stripe)return bad(res,503,'Les réductions ne sont pas disponibles pour le moment.');
 try{const lines=cartLines(req.body?.cart);const promo=await stripePromo(req.body?.code);if(!promo)throw Error('Saisis un code promotionnel.');
  const min=promo.restrictions?.minimum_amount;
  const sub=lines.reduce((n,l)=>n+l.amount*l.quantity,0);
  if(min&&sub<min)throw Error('Ce code nécessite un montant de commande supérieur.');
  if(promo.restrictions?.first_time_transaction) return res.json({valid:true,message:'Code reconnu. L’éligibilité à la première commande sera vérifiée au paiement.'});
  return res.json({valid:true,message:'Code reconnu. La réduction sera confirmée lors du paiement.'});
 }catch(e){return bad(res,400,e.message||'Code non reconnu.')}
});
app.post('/api/checkout/start',async(req,res)=>{
 if(!checkoutReady())return bad(res,503,'Le paiement sécurisé n’est pas encore activé sur la boutique.');
 let orderId=null;
 try{
  const d=req.body||{};const lines=cartLines(d.cart);const address=cleanAddress(d.address);
  const email=protectedText(d.email,250).toLowerCase();if(!/^\S+@\S+\.\S+$/.test(email))throw Error('Adresse e-mail invalide.');
  const method=protectedText(d.method,24);
  if(!['card','applepay','paypal','klarna','shop'].includes(method))throw Error('Moyen de paiement non reconnu.');
  if(method==='shop')return bad(res,503,'Shop Pay n’est pas encore connecté à la boutique.');
  const paymentTypes=method==='paypal'?['paypal']:method==='klarna'?['klarna']:['card'];
  const promo=await stripePromo(d.promo);
  const fee=fees(lines,address.country);
  const totalBeforeDiscount=lines.reduce((n,l)=>n+l.amount*l.quantity,0)+fee;
  const billing=d.billing&&typeof d.billing==='object'?{firstName:protectedText(d.billing.firstName,80),lastName:protectedText(d.billing.lastName,80),address1:protectedText(d.billing.address1,180),zip:protectedText(d.billing.zip,16),city:protectedText(d.billing.city,110)}:null;
  const user=await userFromToken(req.headers.authorization);
  orderId=randomUUID();
  const order={id:orderId,user_id:user?.id||null,email,status:'pending',total_cents:totalBeforeDiscount,currency:'eur',payload:{lines,shipping:address,billing,freeSamples:!!d.freeSamples,giftNote:protectedText(d.giftNote,500),newsletterConsent:!!d.newsletter,requestedPayment:method}};
  const insert=await supabase.from('orders').insert(order);
  if(insert.error)throw Error('Impossible d’enregistrer la commande.');
  const stripeLines=lines.map(l=>({price_data:{currency:'eur',unit_amount:l.amount,product_data:{name:l.name+(l.volume?' - '+l.volume+' ml':'')}},quantity:l.quantity}));
  if(fee)stripeLines.push({price_data:{currency:'eur',unit_amount:fee,product_data:{name:'Frais de livraison'}},quantity:1});
  const session=await stripe.checkout.sessions.create({
   mode:'payment',locale:'fr',customer_email:email,payment_method_types:paymentTypes,
   line_items:stripeLines,
   ...(promo?{discounts:[{promotion_code:promo.id}]}:{allow_promotion_codes:true}),
   success_url:`${allowedOrigins}/?checkout_session_id={CHECKOUT_SESSION_ID}#/`,
   cancel_url:`${allowedOrigins}/#/shop`,
   client_reference_id:orderId,metadata:{order_id:orderId,free_samples:d.freeSamples?'yes':'no'},
   billing_address_collection:'auto',phone_number_collection:{enabled:false}
  },{idempotencyKey:orderId});
  const saved=await supabase.from('orders').update({stripe_session_id:session.id}).eq('id',orderId);
  if(saved.error)console.error('Erreur de session pour la commande',orderId,saved.error.message);
  res.json({url:session.url});
 }catch(e){console.error('checkout error',e.message);if(orderId&&supabase)await supabase.from('orders').update({status:'failed'}).eq('id',orderId);return bad(res,400,e.message||'Paiement momentanément indisponible.')}
});
app.get('/api/checkout/status',async(req,res)=>{
 if(!stripe)return bad(res,503,'Service indisponible.');
 const sessionId=protectedText(req.query.session_id,140);
 if(!/^cs_(test_|live_)[a-zA-Z0-9]+$/.test(sessionId))return bad(res,400,'Identifiant de paiement invalide.');
 try{const session=await stripe.checkout.sessions.retrieve(sessionId);if(session.payment_status==='paid')await updateOrder(session,'paid');res.json({paid:session.payment_status==='paid',status:session.payment_status})}catch(e){return bad(res,404,'Commande introuvable.')}
});
app.get('/api/orders',async(req,res)=>{
 if(!supabase)return bad(res,503,'Comptes indisponibles.');
 const user=await userFromToken(req.headers.authorization);if(!user)return bad(res,401,'Connectez-vous pour accéder à vos commandes.');
 const {data,error}=await supabase.from('orders').select('id,created_at,paid_at,status,total_cents,currency').eq('user_id',user.id).order('created_at',{ascending:false}).limit(50);
 if(error)return bad(res,500,'Impossible de charger les commandes.');res.json({orders:data});
});
app.use(express.static(path.join(root,'public'),{index:'index.html',extensions:['html']}));
app.get('/{*splat}',(_req,res)=>res.sendFile(path.join(root,'public','index.html')));
app.listen(port,()=>console.log(`Vince Kawaii : http://localhost:${port}`));
