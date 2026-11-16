import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { companyCodeLookup, generateCompanyCode } from './company-code';
import { CompanyCodeDto } from './dto/company-code.dto';

describe('credencial alfanumérica por empresa', () => {
  it('genera 10 caracteres en mayúsculas con letras y números sin patrón repetido', () => {
    const codes = new Set(Array.from({ length: 250 }, generateCompanyCode));
    expect(codes.size).toBe(250);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9]{10}$/);
      expect(code).toMatch(/[A-Z]/); expect(code).toMatch(/[0-9]/);
    }
  });
  it('el lookup depende de la clave del servidor y nunca contiene el código', () => {
    const a = companyCodeLookup('ABCD1234EF', 'test-pepper-A');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('ABCD1234EF');
    expect(a).not.toBe(companyCodeLookup('ABCD1234EF', 'test-pepper-B'));
  });
  it('normaliza el teclado a mayúsculas y exige exactamente 10 caracteres alfanuméricos', async () => {
    const valid = plainToInstance(CompanyCodeDto, { code: ' abcd1234ef ' });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.code).toBe('ABCD1234EF');
    for (const code of ['123456', 'ABCD1234EF0', 'ABCD-12345', '<script/>!', null]) {
      expect((await validate(plainToInstance(CompanyCodeDto, { code }))).length).toBeGreaterThan(0);
    }
  });
});
