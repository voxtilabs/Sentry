/** Usa el formulario normal y espera un CAPTCHA válido resuelto en la página. */
export function scriptConsultaPublica(plate:string):string {
  return `(function(){
    if(window.__sentryPublicTimer)clearInterval(window.__sentryPublicTimer);
    var plate=${JSON.stringify(plate)};
    var sent=false,submitted=false;
    function tick(){
      try {
        if(window.IsResponse===true && window.response && window.response.Cod===0 && String(window.tipo_s)==='1'){
          var searched=String(window.valor_s||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
          if(searched!==plate)return;
          var r=window.response.Result;
          if(!r||!Object.prototype.hasOwnProperty.call(r,'CodTipoEncargo'))return;
          var status='no_consultado';
          if(Number(r.CodTipoEncargo)===0)status='sin_encargo';
          else if(Number(r.CodTipoEncargo)===1 && Array.isArray(r.Especies) && r.Especies.length && Number(r.EUN)>0 && typeof window.evaluarConsultaVehiculoDesdeEspecies==='function'){
            var evaluation=window.evaluarConsultaVehiculoDesdeEspecies(r.Especies,r.EUN);
            if(evaluation.resultado==='Sin encargo')status='sin_encargo';
            else if(evaluation.resultado==='Encargo parcial')status='encargo_parcial';
            else if(evaluation.resultado==='Encargo policial vigente')status='con_encargo';
          }
          if(status!=='no_consultado'&&!sent){sent=true;window.ReactNativeWebView.postMessage(JSON.stringify({source:'autoseguro',plate:plate,stolenStatus:status,checkedAt:new Date().toISOString()}));}
          return;
        }
        if(window.IsResponse===true)return;
        var input=document.getElementById('txt_placa_patente');
        if(input && input.value!==plate){input.value=plate;input.dispatchEvent(new Event('input',{bubbles:true}));}
        var country=document.getElementById('cbx_pais_incripcion');
        if(country && country.value!=='210'){country.value='210';country.dispatchEvent(new Event('change',{bubbles:true}));}
        var form=document.getElementById('frmCaptcha');
        // No se genera, copia ni omite el token: lo obtiene la página oficial.
        if(!submitted&&form&&window.grecaptcha&&window.grecaptcha.getResponse().length>0){submitted=true;form.requestSubmit();}
      }catch(e){}
    }
    tick();window.__sentryPublicTimer=setInterval(tick,700);
  })();true;`;
}

