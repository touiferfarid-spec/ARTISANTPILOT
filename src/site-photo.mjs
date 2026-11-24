import sharp from 'sharp';

export async function prepareSitePhoto(value) {
  if(typeof value!=='string'||value.length>710000)throw Error('Choisissez une image JPEG, PNG ou WebP plus petite.');
  const match=/^data:image\/(?:jpeg|png|webp);base64,([a-zA-Z0-9+/]+=*)$/.exec(value);
  if(!match)throw Error('Choisissez une photo au format JPEG, PNG ou WebP.');
  try {
    const photo=sharp(Buffer.from(match[1],'base64'),{limitInputPixels:16000000,failOn:'warning'});
    const metadata=await photo.metadata();
    if(!['jpeg','png','webp'].includes(metadata.format)||(metadata.pages||1)>1)throw Error();
    const bytes=await photo.rotate().resize({width:960,height:960,fit:'inside',withoutEnlargement:true}).webp({quality:72}).toBuffer();
    if(bytes.length>240000)throw Error();
    return 'data:image/webp;base64,'+bytes.toString('base64');
  }catch{throw Error('Cette photo est illisible ou trop grande. Choisissez une autre image.');}
}
