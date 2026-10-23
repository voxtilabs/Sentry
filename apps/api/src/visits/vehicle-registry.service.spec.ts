import { VehicleRegistryService } from './vehicle-registry.service';

describe('consulta vehicular pública automática',()=>{
  const original=global.fetch;
  afterEach(()=>{global.fetch=original;});
  function sources(car:unknown,community:unknown={found:false}) {
    const request=jest.fn(async (url:string)=>{
      if(url.startsWith('https://www.cipat.cl/'))return Response.json(community);
      if(url==='https://autosign.cl/fact/')return new Response('<input name="csrfmiddlewaretoken" value="example-token">',{headers:{'Set-Cookie':'csrftoken=example-cookie; Secure; HttpOnly'}});
      if(url==='https://autosign.cl/api/check_car/')return Response.json(car);
      throw new Error('Fuente no autorizada');
    });
    global.fetch=request as typeof fetch;
    return request;
  }
  it('un error o CAPTCHA no se interpreta como vehículo sin encargo ni multas',async()=>{
    global.fetch=jest.fn().mockResolvedValue(new Response('Error',{status:500}));
    expect(await new VehicleRegistryService().lookup('ABCD12')).toMatchObject({detailsStatus:'no_disponible',stolenStatus:'no_consultado',finesStatus:'no_consultado',ownerName:null,community:{status:'no_disponible'}});
  });
  it('usa la sesión normal del formulario y descarta todos los campos innecesarios',async()=>{
    const request=sources({status:'success',car:{license_no:'ABCD12',brand:'MARCA',model:'MODELO',color:'AZUL',owner:{fullname:'Titular ficticio',rut:'11111111-1'},engine:'ignored',chassis:'ignored'}});
    const result=await new VehicleRegistryService().lookup('ABCD12');
    expect(result).toMatchObject({source:'AutoSign (consulta pública)',make:'MARCA',model:'MODELO',color:'AZUL',ownerName:'Titular ficticio',finesStatus:'no_consultado',stolenStatus:'no_consultado'});
    expect(JSON.stringify(result)).not.toMatch(/11111111|ignored/);
    const post=request.mock.calls.find(call=>call[0]==='https://autosign.cl/api/check_car/');
    expect((post as unknown as [string,RequestInit])[1].headers).toMatchObject({'X-CSRFToken':'example-token',Cookie:'csrftoken=example-cookie'});
  });
  it('rechaza datos de otra patente aunque la fuente responda success',async()=>{
    sources({status:'success',car:{license_no:'ZZZZ99',brand:'OTRO'}});
    expect((await new VehicleRegistryService().lookup('ABCD12')).make).toBeNull();
  });
  it('un vehículo no registrado en CIPAT no se presenta como libre de encargos oficiales',async()=>{
    sources({status:'unavailable'},{found:false,message:'Vehículo no registrado en el sistema'});
    expect(await new VehicleRegistryService().lookup('ABCD12')).toMatchObject({stolenStatus:'no_consultado',community:{status:'sin_registro',make:null}});
  });
  it('conserva la alerta comunitaria separada del estado oficial y filtra datos ajenos al informe',async()=>{
    sources({status:'unavailable'},{found:true,vehicle:{patente:'ABCD12',is_stolen:true,marca:'MARCA',modelo:'MODELO',color:'ROJO',owner_phone:'ignored',rut:'11111111-1',description:'ignored'}});
    const result=await new VehicleRegistryService().lookup('ABCD12');
    expect(result).toMatchObject({stolenStatus:'no_consultado',ownerName:null,community:{status:'reportado',make:'MARCA',model:'MODELO',color:'ROJO'}});
    expect(JSON.stringify(result)).not.toMatch(/11111111|ignored/);
  });
  it.each([{found:true,vehicle:{patente:'ZZZZ99',is_stolen:true}}, {found:true,vehicle:{patente:'ABCD12',is_stolen:'false'}}, {message:'Request rejected'}])('una respuesta ajena o incompleta no valida antecedentes: %j',async community=>{
    sources({status:'unavailable'},community);
    expect((await new VehicleRegistryService().lookup('ABCD12')).community?.status).toBe('no_disponible');
  });
});
