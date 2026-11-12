import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';
const source=ts.createSourceFile('App.tsx',readFileSync(join(__dirname,'../../App.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function callback():string {let expression='';function walk(n:ts.Node){if(ts.isJsxAttribute(n)&&n.name.getText(source)==='onRenderProcessGone'&&n.initializer&&ts.isJsxExpression(n.initializer))expression=n.initializer.expression?.getText(source)??'';ts.forEachChild(n,walk)}walk(source);assert.ok(expression,'WebView debe manejar la pérdida del renderizador');return expression;}
test('recrea una vez el motor muerto y ofrece recuperación manual si se repite',()=>{let generation=0,failures=0;const reports:string[]=[];const cargado={current:true};const handler=new Function('reportarCaida','portal','recuperacionesMotor','cargadoInicialmente','setFailed','setLoading','setGeneracionWebView','setMotivoFallo','mostrarFallo',`return (${callback()})`)(async(e:Error)=>{reports.push(e.message)}, {origin:'https://example.test'},{current:0},cargado,()=>{},()=>{},(f:(n:number)=>number)=>{generation=f(generation)},()=>{},()=>{failures++});handler({nativeEvent:{didCrash:false}});assert.equal(generation,1);assert.equal(cargado.current,false);handler({nativeEvent:{didCrash:true}});assert.equal(generation,1);assert.equal(failures,1);assert.deepEqual(reports,['WebViewRendererKilled','WebViewRendererCrash']);});

test('salir a la cámara y volver solo consulta la conexión, sin recrear WebView',()=>{
  let expression='';
  function walk(n:ts.Node){
    if(ts.isCallExpression(n)&&n.expression.getText(source)==='AppState.addEventListener'){
      expression=n.arguments[1]?.getText(source)??'';
    }
    ts.forEachChild(n,walk);
  }
  walk(source);assert.ok(expression,'falta el listener de primer/segundo plano');
  let consultas=0,recreaciones=0;
  const listener=new Function('preguntarDeNuevo','setGeneracionWebView','mostrarFallo',`return (${expression})`)(()=>{consultas++},()=>{recreaciones++},()=>{recreaciones++});
  listener('background');assert.equal(consultas,0);assert.equal(recreaciones,0);
  listener('active');assert.equal(consultas,1);assert.equal(recreaciones,0);
  listener('background');listener('active');assert.equal(consultas,2);assert.equal(recreaciones,0);
});
