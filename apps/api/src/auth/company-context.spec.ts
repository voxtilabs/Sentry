import { UnauthorizedException } from '@nestjs/common';
import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import { CompanyContext } from './company-context';
function setup(){
 const store=new Map<string,string>();
 const redis={get:async(k:string)=>store.get(k)??null,set:async(k:string,v:string)=>{store.set(k,v)},del:async(k:string)=>{store.delete(k)}} as unknown as Redis;
 const query=jest.fn().mockResolvedValue([{user_id:'g',tenant_id:'a',role_key:'GUARDIA'}]);
 return {c:new CompanyContext({query} as unknown as DataSource,redis),query};
}
describe('continuación de la empresa en dispositivo compartido',()=>{
 it('no entrega guardias de otra empresa y queda revocada con el cierre completo',async()=>{
  const {c,query}=setup(),token=await c.issue({uid:'AABB',tenantId:'a'},'phone');
  expect((await c.guards(token,'phone')).guards.map(g=>g.user_id)).toEqual(['g']);
  query.mockResolvedValue([{user_id:'otro',tenant_id:'b',role_key:'GUARDIA'}]);
  await expect(c.guards(token,'phone')).rejects.toBeInstanceOf(UnauthorizedException);
  await c.revoke(token);await expect(c.guards(token,'phone')).rejects.toBeInstanceOf(UnauthorizedException);
 });
 it('rechaza token inventado, otro dispositivo y tarjeta revocada',async()=>{
  const {c,query}=setup(),token=await c.issue({uid:'AABB',tenantId:'a'},'phone');
  await expect(c.guards(token,'other')).rejects.toBeInstanceOf(UnauthorizedException);
  await expect(c.guards('x'.repeat(43),'phone')).rejects.toBeInstanceOf(UnauthorizedException);
  query.mockResolvedValue([]);await expect(c.guards(token,'phone')).rejects.toBeInstanceOf(UnauthorizedException);
 });
});
