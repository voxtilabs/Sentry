import { normalizarPatente,normalizarRun } from '@sentrycore/shared';
describe('identificación de visitas',()=>{
  it('normaliza RUN y exige dígito verificador válido',()=>{
    expect(normalizarRun('12.345.678-5')).toBe('12345678-5');
    expect(normalizarRun('12.345.678-9')).toBeNull();
    expect(normalizarRun('999999999')).toBeNull();
    expect(normalizarRun('00000000-0')).toBeNull();
  });
  it('reconoce formatos de patente y rechaza texto arbitrario',()=>{
    for(const plate of ['ABCD-12','AB 1234','ZZY17','ABC012']) expect(normalizarPatente(plate)).not.toBeNull();
    for(const plate of ['https://example.com','123456','ABCD123456','<script>']) expect(normalizarPatente(plate)).toBeNull();
  });
});
