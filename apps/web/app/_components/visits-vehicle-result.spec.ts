import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VehicleResult } from './visits';

function report(stolenStatus:string,communityReported=false) {
  return renderToStaticMarkup(createElement(VehicleResult,{check:{
    lookupId:'fixture',plate:'ABCD12',checkedAt:'2026-10-24T00:00:00.000Z',
    source:null,detailsStatus:'no_disponible',make:null,model:null,color:null,ownerName:null,
    stolenStatus,finesStatus:'no_consultado',finesCount:null,finesTotal:null,
    ...(communityReported?{community:{source:'CIPAT',status:'reportado',checkedAt:'2026-10-24T00:00:00.000Z',make:null,model:null,color:null}}:{}),
  }}));
}

describe('alerta de encargo en la ficha vehicular',()=>{
  it.each(['con_encargo','encargo_parcial','placas_con_encargo'])('destaca y anuncia un encargo activo: %s',status=>{
    const html=report(status);
    expect(html).toContain('role="alert"');
    expect(html).toContain('visits-theft-alert');
    expect(html).toContain('ALERTA DE ENCARGO');
  });
  it.each(['sin_encargo','no_consultado','recuperado'])('no presenta como encargo activo un estado distinto: %s',status=>{
    expect(report(status)).not.toContain('visits-theft-alert');
  });
  it('un reporte comunitario no se convierte en encargo del registro oficial',()=>{
    const html=report('no_consultado',true);
    expect(html).not.toContain('ALERTA DE ENCARGO');
    expect(html).toContain('Vehículo reportado como robado');
  });
});
