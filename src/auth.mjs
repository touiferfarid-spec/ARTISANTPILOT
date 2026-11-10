import {config} from './config.mjs';
import {token,sha,cookie,getCookie,passwordHash,passwordVerify,isEmail,encrypt,decrypt,constantTimeEqual} from './security.mjs';
import {sendAccountMail,mailConfigured} from './mail.mjs';
import {AppError} from './errors.mjs';

const stateCookie = (value, expire=false) => `artisan_oauth=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${expire?0:600}${config.prod?'; Secure':''}`;
export async function reservePilotAccount(client) {
  await client.query('SELECT pg_advisory_xact_lock(92740547)');
  const count=(await client.query('SELECT count(*)::int AS total FROM users')).rows[0].total;
  if(count>=config.pilotMaxAccounts)throw new AppError('Les places du pilote sont actuellement réservées. Contactez l’équipe ArtisanPilot pour rejoindre le prochain groupe.',503);
}
export const googleLoginUrl = (state, challenge) => 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: config.googleId, redirect_uri: config.baseUrl+'/api/google/callback', response_type:'code',
  scope:'openid email profile', state, code_challenge:challenge, code_challenge_method:'S256', prompt:'select_account'
});
export async function createAuthToken(query,userId,kind) {
  const value=token();
  await query('DELETE FROM auth_tokens WHERE user_id=$1 AND kind=$2',[userId,kind]);
  await query(`INSERT INTO auth_tokens(token_hash,user_id,kind,expires_at) VALUES($1,$2,$3,now()+($4::int * interval '1 minute'))`,[sha(value),userId,kind,kind==='reset'?30:1440]);
  return value;
}
export async function authRoutes(req,res,url,ctx) {
  const {query,pool,send,readJson,sessionUser,rateGuard,audit}=ctx;
  const p=url.pathname,m=req.method;
  if(p==='/api/auth/options' && m==='GET') {
    send(res,{google:Boolean(config.googleId&&config.googleSecret&&config.encryptionKey),email:mailConfigured()});return true;
  }
  if(p==='/api/auth/google' && m==='GET') {
    if(!config.googleId||!config.googleSecret||!/^[a-f0-9]{64}$/i.test(config.encryptionKey))throw new AppError('Connexion Google non configurée.',503);
    await rateGuard(req,'google-login',15);
    const value=token(),verifier=token(),challenge=Buffer.from(sha(verifier),'hex').toString('base64url');
    await query("INSERT INTO login_states(state_hash,verifier,expires_at) VALUES($1,$2,now()+interval '10 minutes')",[sha(value),encrypt({verifier})]);
    res.writeHead(303,{'location':googleLoginUrl(value,challenge),'cache-control':'no-store','set-cookie':stateCookie(value)});res.end();return true;
  }
  if(p==='/api/google/callback' && m==='GET') {
    const state=url.searchParams.get('state')||'';
    if(!/^[a-f0-9]{64}$/.test(state))return false;
    const found=await query('SELECT verifier FROM login_states WHERE state_hash=$1 AND expires_at>now()',[sha(state)]);
    if(!found.rows.length)return false;
    if(!constantTimeEqual(getCookie(req,'artisan_oauth'),state))throw new AppError('Autorisation Google invalide. Recommencez la connexion.',403);
    const used=await query('DELETE FROM login_states WHERE state_hash=$1 AND expires_at>now() RETURNING verifier',[sha(state)]);
    if(!used.rows.length)throw new AppError('Cette autorisation a déjà été utilisée.',400);
    if(url.searchParams.get('error')){res.writeHead(303,{location:'/account#google=cancelled','set-cookie':stateCookie('',true)});res.end();return true;}
    const code=url.searchParams.get('code');if(!code)throw new AppError('Connexion Google refusée.',400);
    const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({
      client_id:config.googleId,client_secret:config.googleSecret,code,code_verifier:decrypt(used.rows[0].verifier).verifier,
      redirect_uri:config.baseUrl+'/api/google/callback',grant_type:'authorization_code'
    }),signal:AbortSignal.timeout(15000)});
    const credentials=await r.json();
    if(!r.ok||!credentials.access_token)throw new AppError('Google n’a pas confirmé la connexion.',400);
    const u=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:'Bearer '+credentials.access_token},signal:AbortSignal.timeout(10000)});
    const identity=await u.json();
    if(!u.ok||identity.email_verified!==true||!isEmail(identity.email)||!identity.sub)throw new AppError('Utilisez une adresse vérifiée par Google.',403);
    const c=await pool.connect();let user;
    try {
      await c.query('BEGIN');
      const existing=await c.query("SELECT u.id,u.email,u.email_verified FROM identities i JOIN users u ON u.id=i.user_id WHERE i.provider='google' AND i.subject=$1",[identity.sub]);
      user=existing.rows[0];
      if(!user){
        const email=identity.email.toLowerCase();
        const known=await c.query('SELECT id FROM users WHERE email=$1',[email]);
        if(!known.rows.length)await reservePilotAccount(c);
        await c.query("INSERT INTO users(email,password_hash,email_verified) VALUES($1,$2,true) ON CONFLICT(email) DO NOTHING",[email,await passwordHash(token())]);
        const found=await c.query('SELECT id,email,email_verified FROM users WHERE email=$1 FOR UPDATE',[email]);user=found.rows[0];
        // Remove pre-registration credentials and sessions for an unverified email.
        if(!user.email_verified){await c.query('UPDATE users SET password_hash=$1,email_verified=true WHERE id=$2',[await passwordHash(token()),user.id]);await c.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);}
        await c.query("INSERT INTO identities(provider,subject,user_id) VALUES('google',$1,$2)",[identity.sub,user.id]);
      }
      const value=token();await c.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",[sha(value),user.id]);
      await c.query('COMMIT');
      res.writeHead(303,{location:'/studio','cache-control':'no-store','set-cookie':[cookie(value),stateCookie('',true)]});res.end();
    }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
    await audit(user.id,'auth.google');return true;
  }
  if(p==='/api/auth/forgot'&&m==='POST') {
    await rateGuard(req,'password-reset',4,900000);
    if(!mailConfigured())throw new AppError('La récupération par email n’est pas encore disponible. Utilisez Google si cette adresse est associée à votre compte.',503);
    const x=await readJson(req),email=String(x.email||'').trim().toLowerCase();
    if(!isEmail(email))throw new AppError('Indiquez une adresse email valide.',422);
    const r=await query('SELECT id FROM users WHERE email=$1',[email]);
    if(r.rows[0]){
      try{await sendAccountMail(email,'reset',await createAuthToken(query,r.rows[0].id,'reset'));}
      catch{console.warn('Account mail delivery failed');}
    }
    send(res,{message:'Si un compte correspond à cette adresse, un lien vous sera envoyé.'});return true;
  }
  if(p==='/api/auth/reset'&&m==='POST') {
    await rateGuard(req,'reset-token',8,900000);
    const x=await readJson(req);if(!/^[a-f0-9]{64}$/.test(x.token||''))throw new AppError('Lien invalide ou expiré.',422);
    if(typeof x.password!=='string'||x.password.length<12||x.password.length>160)throw new AppError('Le mot de passe doit contenir 12 à 160 caractères.',422);
    const hash=await passwordHash(x.password),c=await pool.connect();
    try{
      await c.query('BEGIN');
      const r=await c.query("DELETE FROM auth_tokens WHERE token_hash=$1 AND kind='reset' AND expires_at>now() RETURNING user_id",[sha(x.token)]);
      if(!r.rows[0])throw new AppError('Lien invalide ou expiré.',422);
      await c.query('UPDATE users SET password_hash=$1,email_verified=true WHERE id=$2',[hash,r.rows[0].user_id]);
      await c.query('DELETE FROM sessions WHERE user_id=$1',[r.rows[0].user_id]);
      await c.query('DELETE FROM auth_tokens WHERE user_id=$1',[r.rows[0].user_id]);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
    send(res,{message:'Mot de passe enregistré. Reconnectez-vous.'},200,{'set-cookie':cookie('',{expire:true})});return true;
  }
  if(p==='/api/auth/verify'&&m==='POST') {
    await rateGuard(req,'verify-token',10,900000);
    const x=await readJson(req);if(!/^[a-f0-9]{64}$/.test(x.token||''))throw new AppError('Lien invalide ou expiré.',422);
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      const r=await c.query("DELETE FROM auth_tokens WHERE token_hash=$1 AND kind='verify' AND expires_at>now() RETURNING user_id",[sha(x.token)]);
      if(!r.rows[0])throw new AppError('Lien invalide ou expiré.',422);
      await c.query('UPDATE users SET email_verified=true WHERE id=$1',[r.rows[0].user_id]);await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
    send(res,{message:'Votre adresse email est confirmée.'});return true;
  }
  if(p==='/api/auth/verify/send'&&m==='POST') {
    const a=await sessionUser(req);if(!a)throw new AppError('Connectez-vous.',401);
    await rateGuard(req,'verify-mail',3,900000);
    if(!a.email_verified)await sendAccountMail(a.email,'verify',await createAuthToken(query,a.id,'verify'));
    send(res,{message:a.email_verified?'Adresse déjà confirmée.':'Email de confirmation envoyé.'});return true;
  }
  if(p==='/api/auth/password'&&m==='POST') {
    const a=await sessionUser(req);if(!a)throw new AppError('Connectez-vous.',401);
    await rateGuard(req,'password-change',4,900000);
    const x=await readJson(req),r=await query('SELECT password_hash FROM users WHERE id=$1',[a.id]);
    if(typeof x.password!=='string'||x.password.length<12||x.password.length>160)throw new AppError('Le mot de passe doit contenir 12 à 160 caractères.',422);
    if(!(await passwordVerify(x.currentPassword||'',r.rows[0].password_hash)))throw new AppError('Mot de passe actuel incorrect.',401);
    const hash=await passwordHash(x.password),c=await pool.connect();
    try{await c.query('BEGIN');await c.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,a.id]);await c.query('DELETE FROM sessions WHERE user_id=$1',[a.id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
    send(res,{message:'Mot de passe modifié. Reconnectez-vous.'},200,{'set-cookie':cookie('',{expire:true})});return true;
  }
  return false;
}
