'use strict';
const $=id=>document.getElementById(id);
let mode=new URLSearchParams(location.search).get('mode')==='register'?'register':'login';
const fragment=new URLSearchParams(location.hash.slice(1));const resetToken=fragment.get('reset'),verifyToken=fragment.get('verify');
// Remove one-use credentials from browser history as soon as they have been read.
if(resetToken||verifyToken)history.replaceState({},'','/account');
const api=async(path,body)=>{const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(d.error||'Connexion indisponible.');return d;};
function render(){
 const register=mode==='register',forgot=mode==='forgot',reset=mode==='reset';
 $('authTitle').textContent=register?'Votre activité prend son envol.':forgot?'Retrouvons votre compte.':reset?'Un nouveau départ.':'Heureux de vous retrouver.';
 $('authSub').textContent=register?'Créez votre compte pour préparer votre premier site.':forgot?'Recevez un lien pour choisir un nouveau mot de passe.':reset?'Choisissez un mot de passe de 12 caractères minimum.':'Connectez-vous pour retrouver votre activité.';
 $('submit').textContent=register?'Créer mon compte →':forgot?'Recevoir le lien →':reset?'Enregistrer le mot de passe →':'Se connecter →';
 $('emailLabel').hidden=reset;$('email').required=!reset;
 $('passwordLabel').hidden=forgot;$('password').required=!forgot;$('password').autocomplete=register||reset?'new-password':'current-password';
 $('termsNote').hidden=!register;$('forgot').hidden=forgot||reset;
 $('switchText').textContent=register?'Déjà inscrit ?':'Pas encore de compte ?';$('switchMode').textContent=register||forgot||reset?'Se connecter':'Créer mon compte';
 $('feedback').textContent='';
}
$('switchMode').onclick=()=>{mode=mode==='login'?'register':'login';render();};
$('forgot').onclick=()=>{mode='forgot';render();};
$('accountForm').onsubmit=async e=>{e.preventDefault();$('submit').disabled=true;$('feedback').textContent='Un instant…';try{
 const route=mode==='forgot'?'forgot':mode==='reset'?'reset':mode;
 const d=await api('/api/auth/'+route,{email:$('email').value,password:$('password').value,token:resetToken});
 if(d.user){location.assign('/studio');return;}$('feedback').textContent=d.message||'Enregistré.';
 if(mode==='reset'){$('continue').textContent='Se reconnecter →';$('continue').href='/account';$('continue').hidden=false;$('accountForm').hidden=true;}
 }catch(e){$('feedback').textContent=e.message}finally{$('submit').disabled=false}};
(async()=>{if(resetToken)mode='reset';render();try{
 const [opts,me]=await Promise.all([api('/api/auth/options'),api('/api/me')]);
 $('googleLogin').hidden=!opts.google||!!resetToken;$('authDivider').hidden=!opts.google||!!resetToken;
 $('forgot').hidden=!opts.email||mode==='forgot'||mode==='reset';
 if(me.user&&!resetToken&&!verifyToken){location.replace('/studio');return;}
 if(verifyToken){const d=await api('/api/auth/verify',{token:verifyToken});$('feedback').textContent=d.message;$('continue').hidden=false;}
 if(fragment.get('google')==='cancelled')$('feedback').textContent='Connexion Google annulée. Vous pouvez réessayer.';
 }catch(e){$('feedback').textContent=e.message}})();
