export interface OperationSite{id:string;name:string;branchName:string;timezone:string;}
export async function operationRequest<T>(url:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch(url,{method,credentials:'include',cache:'no-store',signal,headers:body!==undefined?{'Content-Type':'application/json','X-SentryCore-Request':'web'}:undefined,...(body!==undefined?{body:JSON.stringify(body)}:{})});
 if(!response.ok){const error=await response.json().catch(()=>null) as {message?:string|string[]}|null;throw new Error(Array.isArray(error?.message)?error.message.join('. '):error?.message??'No pudimos completar la operación.');}
 return response.json() as Promise<T>;
}
export function operationError(value:unknown):string{return value instanceof Error?value.message:'Revisa tu conexión e inténtalo nuevamente.';}
