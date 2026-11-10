(() => {
  'use strict';
  const button=document.getElementById('showZone'),canvas=document.getElementById('zoneMap'),feedback=document.getElementById('zoneFeedback');
  let place=null,map=null,circle=null,loading=null,shown=false;
  const radius=()=>Number(document.querySelector('[name="radius_km"]').value)*1000;
  function draw(){
    if(!place||!map)return;
    const center={lat:Number(place.lat),lng:Number(place.lng)};
    if(!circle)circle=new google.maps.Circle({map,strokeColor:'#214e3d',strokeWeight:2,fillColor:'#83a85b',fillOpacity:.18,clickable:false});
    circle.setCenter(center);circle.setRadius(radius());map.fitBounds(circle.getBounds());
    feedback.textContent=`${place.name} · ${radius()/1000} km autour de la commune. Cette carte représente votre rayon déclaré.`;
  }
  window.ArtisanZone={update(city){place=city;if(map)circle?.setVisible(Boolean(place));if(place)draw();else feedback.textContent='Choisissez une commune dans les suggestions pour afficher votre zone.';}};
  document.querySelector('[name="radius_km"]').addEventListener('change',draw);
  function load(key){
    if(window.google?.maps?.Map)return Promise.resolve();
    if(loading)return loading;
    loading=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('La carte ne répond pas. Vérifiez les autorisations Google Maps.')),15000);
      window.artisanMapReady=()=>{clearTimeout(timer);resolve();};
      window.gm_authFailure=()=>{clearTimeout(timer);canvas.hidden=true;feedback.textContent='Google Maps refuse cette clé ou cette adresse de site. La sélection de commune reste disponible.';reject(Error(feedback.textContent));};
      const script=document.createElement('script');script.async=true;
      script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key,callback:'artisanMapReady',loading:'async',v:'quarterly',language:'fr',region:'FR'});
      script.onerror=()=>{clearTimeout(timer);reject(Error('La carte Google ne peut pas être chargée.'));};document.head.append(script);
    });return loading;
  }
  button.addEventListener('click',async()=>{
    if(!place){feedback.textContent='Sélectionnez votre ville dans les suggestions avant d’afficher la carte.';return;}
    button.disabled=true;feedback.textContent='Chargement de votre zone…';
    try{
      const response=await fetch('/api/maps/config');const settings=await response.json();
      if(!response.ok||!settings.browserKey)throw Error('Google Maps n’est pas configuré. Votre commune et votre rayon restent enregistrables.');
      await load(settings.browserKey);canvas.hidden=false;
      if(!map)map=new google.maps.Map(canvas,{center:{lat:place.lat,lng:place.lng},zoom:10,mapTypeControl:false,streetViewControl:false,fullscreenControl:false});
      shown=true;draw();button.textContent='Actualiser ma zone';
    }catch(e){feedback.textContent=e.message;if(!shown)canvas.hidden=true;}finally{button.disabled=false;}
  });
})();
