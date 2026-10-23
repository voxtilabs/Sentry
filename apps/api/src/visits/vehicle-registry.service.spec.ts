import { VehicleRegistryService } from './vehicle-registry.service';

describe('consulta vehicular pública',()=>{
  const original=global.fetch;
  afterEach(()=>{global.fetch=original;});
  it('un error o CAPTCHA no se interpreta como vehículo sin encargo ni multas',async()=>{
    global.fetch=jest.fn().mockResolvedValue(new Response('Error',{status:500}));
    expect(await new VehicleRegistryService().lookup('ABCD12')).toMatchObject({detailsStatus:'no_disponible',stolenStatus:'no_consultado',finesStatus:'no_consultado',ownerName:null});
  });
  it('usa la sesión normal del formulario y descarta todos los campos innecesarios',async()=>{
    const request=jest.fn()
      .mockResolvedValueOnce(new Response('<input name="csrfmiddlewaretoken" value="example-token">',{headers:{'Set-Cookie':'csrftoken=example-cookie; Secure; HttpOnly'}}))
      .mockResolvedValueOnce(Response.json({status:'success',car:{license_no:'ABCD12',brand:'MARCA',model:'MODELO',color:'AZUL',owner:{fullname:'Titular ficticio',rut:'11111111-1'},engine:'ignored',chassis:'ignored'}}));
    global.fetch=request;
    const result=await new VehicleRegistryService().lookup('ABCD12');
    expect(result).toMatchObject({source:'AutoSign (consulta pública)',make:'MARCA',model:'MODELO',color:'AZUL',ownerName:'Titular ficticio',finesStatus:'no_consultado',stolenStatus:'no_consultado'});
    expect(JSON.stringify(result)).not.toMatch(/11111111|ignored/);
    expect(request.mock.calls[1]![1].headers).toMatchObject({'X-CSRFToken':'example-token',Cookie:'csrftoken=example-cookie'});
  });
  it('rechaza datos de otra patente aunque la fuente responda success',async()=>{
    global.fetch=jest.fn().mockResolvedValueOnce(new Response('<input name="csrfmiddlewaretoken" value="test">'))
      .mockResolvedValueOnce(Response.json({status:'success',car:{license_no:'ZZZZ99',brand:'OTRO'}}));
    expect((await new VehicleRegistryService().lookup('ABCD12')).make).toBeNull();
  });
});
