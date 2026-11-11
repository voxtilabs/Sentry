import { VehicleRegistryService } from './vehicle-registry.service';
import { ConfigService } from '@nestjs/config';

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
  it('usa la revisión más reciente de la patente y descarta certificados y números de serie',async()=>{
    global.fetch=jest.fn(async(url:string)=>url.startsWith('https://api.restart.cl/')?Response.json({data:[
      {attributes:{ppu:'ZZZZ99',marca:'OTRO',fecha_revision:'2027-01-01'}},
      {attributes:{ppu:'ABCD12',marca:'MARCA',modelo:'MODELO ANTERIOR',ano_fabricacion:2017,fecha_revision:'2024-07-01'}},
      {attributes:{ppu:'ABCD12',marca:'MARCA',modelo:'MODELO ACTUAL',ano_fabricacion:2017,fecha_revision:'2026-07-02',fecha_vencimiento:'2027-06-30',resultado:'A',num_certificado:'no-conservar',vin:'no-conservar'}},
    ]}):new Response('',{status:503})) as typeof fetch;
    const result=await new VehicleRegistryService().lookup('ABCD12');
    expect(result).toMatchObject({make:'MARCA',model:'MODELO ACTUAL',year:2017,
      inspection:{date:'2026-07-02',expiresAt:'2027-06-30',result:'A'},stolenStatus:'no_consultado'});
    expect(JSON.stringify(result)).not.toMatch(/no-conservar|OTRO|ANTERIOR/);
  });
  function official(result:unknown) {
    const config=new ConfigService({VEHICLE_LOOKUP_WORKER_URL:'http://vehicle-lookup:8090',VEHICLE_LOOKUP_WORKER_TOKEN:'test-only-internal-key-0123456789'});
    global.fetch=jest.fn(async(url:string)=>url.startsWith('http://vehicle-lookup:8090/')
      ?Response.json({plate:'ABCD12',state:'completed',result}):new Response('',{status:503})) as typeof fetch;
    return new VehicleRegistryService(config);
  }
  function fallback(car:unknown,status=200) {
    global.fetch=jest.fn(async(url:string)=>url.startsWith('https://venpu-backend-production-b8c4.up.railway.app/')
      ?Response.json(car,{status}):new Response('',{status:503})) as typeof fetch;
    return new VehicleRegistryService();
  }
  it('completa una ficha ausente en PRT con la consulta pública de Venpu, sin atribuirle encargos o titularidad',async()=>{
    const result=await fallback({type:'success',data:{patent:'ABCD12',brand:'MARCA',model:'MODELO',year:2017,color:'BLANCO',ownerName:'no-conservar',vin:'no-conservar',stolen:true}}).lookup('ABCD12');
    expect(result).toMatchObject({make:'MARCA',model:'MODELO',year:2017,color:'BLANCO',source:'Venpu (consulta pública de patente)',
      ownerName:null,stolenStatus:'no_consultado',finesStatus:'no_consultado'});
    expect(JSON.stringify(result)).not.toContain('no-conservar');
  });
  it.each([
    {type:'success',data:{patent:'ZZZZ99',brand:'OTRO'}},
    {type:'error',data:{patent:'ABCD12',brand:'MARCA'}},
    {type:'success',data:{patent:'ABCD12',year:'sin año'}},
  ])('no mezcla otra patente ni respuestas incompletas con la visita: %j',async value=>{
    expect(await fallback(value).lookup('ABCD12')).toMatchObject({make:null,model:null,detailsStatus:'no_disponible'});
  });
  it('un límite de consultas en la fuente alternativa conserva el estado no disponible',async()=>{
    expect(await fallback({type:'error'},429).lookup('ABCD12')).toMatchObject({make:null,stolenStatus:'no_consultado'});
  });
  it('la fuente alternativa conserva las características ya obtenidas y no modifica el resultado oficial',async()=>{
    const config=new ConfigService({VEHICLE_LOOKUP_WORKER_URL:'http://vehicle-lookup:8090',VEHICLE_LOOKUP_WORKER_TOKEN:'test-only-key-01234567890123456789'});
    global.fetch=jest.fn(async(url:string)=>{
      if(url.startsWith('http://vehicle-lookup:8090/'))return Response.json({plate:'ABCD12',state:'completed',result:{plate:'ABCD12',officialResponseValidated:true,tokenIssued:true,formSubmitted:true,checkedAt:new Date().toISOString(),stolenStatus:'con_encargo'}});
      if(url.startsWith('https://api.restart.cl/'))return Response.json({data:[{attributes:{ppu:'ABCD12',marca:'MARCA PRT',modelo:'MODELO PRT',ano_fabricacion:2017,fecha_revision:'2026-07-02'}}]});
      if(url.startsWith('https://venpu-backend-production-b8c4.up.railway.app/'))return Response.json({type:'success',data:{patent:'ABCD12',brand:'OTRA MARCA',model:'OTRO MODELO',year:2018,color:'BLANCO'}});
      return new Response('',{status:503});
    }) as typeof fetch;
    expect(await new VehicleRegistryService(config).lookup('ABCD12')).toMatchObject({make:'MARCA PRT',model:'MODELO PRT',year:2017,color:'BLANCO',stolenStatus:'con_encargo',officialCheck:{status:'consultado'}});
  });
  it('solo acepta el estado oficial después de un formulario validado para la misma patente',async()=>{
    const result=await official({plate:'ABCD12',officialResponseValidated:true,tokenIssued:true,formSubmitted:true,
      checkedAt:new Date().toISOString(),stolenStatus:'con_encargo'}).lookup('ABCD12');
    expect(result).toMatchObject({stolenStatus:'con_encargo',officialCheck:{status:'consultado'},lookupPending:false});
  });
  it.each([
    {plate:'ZZZZ99'}, {officialResponseValidated:false}, {tokenIssued:false}, {formSubmitted:false},
    {stolenStatus:'sin_reporte'}, {checkedAt:'invalid'}, {checkedAt:'2000-01-01T00:00:00.000Z'},
  ])('un token o resultado incompleto no equivale a ausencia de encargo: %j',async change=>{
    const result=await official({plate:'ABCD12',officialResponseValidated:true,tokenIssued:true,formSubmitted:true,
      checkedAt:new Date().toISOString(),stolenStatus:'sin_encargo',...change}).lookup('ABCD12');
    expect(result).toMatchObject({stolenStatus:'no_consultado',officialCheck:{status:'no_disponible'}});
  });
});
