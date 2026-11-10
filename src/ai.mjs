import {config} from './config.mjs';
export async function structuredCopy(name,properties,instructions,facts,{timeout=25000,maxTokens=1500}={}) {
  if(!config.openaiKey)throw new Error('OpenAI non configuré');
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',headers:{authorization:'Bearer '+config.openaiKey,'content-type':'application/json'},
    body:JSON.stringify({model:config.openaiModel,store:false,instructions,input:JSON.stringify(facts),max_output_tokens:maxTokens,
      text:{format:{type:'json_schema',name,strict:true,schema:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}}}),
    signal:AbortSignal.timeout(timeout)
  });
  if(!response.ok){const error=new Error('OpenAI indisponible');error.code=response.status;throw error;}
  const data=await response.json();
  if(data.status!=='completed')throw new Error('Génération incomplète');
  const text=(data.output||[]).flatMap(o=>o.content||[]).filter(o=>o.type==='output_text').map(o=>o.text).join('');
  return JSON.parse(text);
}
