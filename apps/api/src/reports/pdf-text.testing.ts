import { inflateSync } from 'node:zlib';

/** Read text operands from actual compressed PDF content streams, not a renderer mock. */
export function pdfOperands(pdf: Buffer): string {
 const source=pdf.toString('latin1');let result='';
 for (const m of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
  try {const stream=inflateSync(Buffer.from(m[1]!,'latin1')).toString('latin1');
   result += [...stream.matchAll(/<([a-f0-9]+)>/gi)].map(x=>Buffer.from(x[1]!,'hex').toString('latin1')).join('');
  } catch { /* JPEG streams are not compressed text. */ }
 }
 return result;
}
