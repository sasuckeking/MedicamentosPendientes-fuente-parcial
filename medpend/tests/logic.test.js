'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const L = require('../shared/logic'), M = require('../shared/migracion');

test('hoyISO usa Santo Domingo (UTC-4), no UTC', () => {
  // 02:30 UTC del 16 = 22:30 del 15 en Santo Domingo
  assert.equal(L.hoyISO(new Date('2026-10-16T02:30:00Z')), '2026-10-15');
  assert.equal(L.hoyISO(new Date('2026-10-16T04:00:00Z')), '2026-10-16');
});
test('alertas: 3 días ámbar, 7 días roja, entregado ninguna', () => {
  assert.equal(L.nivelAlerta('pendiente', '2026-10-14', '2026-10-15'), 'ok');
  assert.equal(L.nivelAlerta('pendiente', '2026-10-12', '2026-10-15'), 'ambar');
  assert.equal(L.nivelAlerta('apartado', '2026-10-09', '2026-10-15'), 'ambar');
  assert.equal(L.nivelAlerta('apartado', '2026-10-08', '2026-10-15'), 'roja');
  assert.equal(L.nivelAlerta('entregado', '2026-01-01', '2026-10-15'), 'ninguna');
  assert.equal(L.nivelAlerta('pendiente', '', '2026-10-15'), 'ninguna');
});
test('orden: activos antes que entregados, más antiguos primero', () => {
  const l = [{ id: 'e', estado: 'entregado', fechaInicio: '2026-01-01' }, { id: 'n', estado: 'pendiente', fechaInicio: '2026-10-14' }, { id: 'v', estado: 'enviado', fechaInicio: '2026-10-01' }];
  assert.deepEqual(L.ordenar(l, '2026-10-15').map(r => r.id), ['v', 'n', 'e']);
});
test('cambio de estado: entregado fija fecha real; salir de entregado la limpia', () => {
  const e = L.aplicarCambioEstado({ estado: 'pendiente', fechaEntregaReal: '' }, 'entregado', '2026-10-15');
  assert.equal(e.fechaEntregaReal, '2026-10-15');
  assert.equal(L.aplicarCambioEstado(e, 'apartado').fechaEntregaReal, '');
  assert.throws(() => L.aplicarCambioEstado(e, 'xyz'));
});
test('búsqueda por cliente, medicamento, factura, teléfono y dependiente', () => {
  const l = [{ cliente: 'María Pérez', medicamento: 'Amoxicilina', factura: 'F-100', telefono: '809-555-1', dependiente: 'Ana' }];
  for (const q of ['maría', 'amoxi', 'f-100', '555', 'ana']) assert.equal(L.buscar(l, q).length, 1, q);
  assert.equal(L.buscar(l, 'zzz').length, 0);
});
test('estadísticas: histórico + entregados en BD, sin duplicar', () => {
  const l = [{ estado: 'pendiente', fechaInicio: '2026-10-01' }, { estado: 'entregado', fechaInicio: '2026-09-01' }, { estado: 'apartado', fechaInicio: '2026-10-14' }];
  const s = L.estadisticas(l, 100, '2026-10-15');
  assert.deepEqual([s.activos, s.urgentes, s.entregadosHistorico], [2, 1, 101]);
});
test('migración: idempotente, detecta duplicados entre computadoras y no suma históricos', () => {
  const r = { id: 'a1', fechaInicio: '2026-10-01', medicamento: 'Insulina', cantidad: '2', cliente: 'Juan', telefono: '1', factura: 'F1', estado: 'pendiente', dependiente: 'Ana' };
  const pc1 = { records: [r], historicoEntregados: 500 };
  const pc2 = { records: [{ ...r, id: 'zz9', cliente: 'JUAN ' }, { ...r, id: 'b', medicamento: '', factura: 'F2' }], historicoEntregados: 500 };
  const a = M.analizar([pc1, pc2], new Set(), [{ nombre: 'ana' }]);
  assert.equal(a.nuevos.length, 2); assert.equal(a.duplicadosEnArchivos.length, 1);
  assert.equal(a.incompletos.length, 1); assert.equal(a.historico, 500); assert.equal(a.sinCoincidencia.length, 0);
  const b = M.analizar([pc1], new Set(a.nuevos.map(x => x.huella)));
  assert.equal(b.nuevos.length, 0); assert.equal(b.yImportados.length, 1);
});
