'use strict';
// Normalización e importación idempotente de los JSON extraídos del sistema antiguo.
const crypto = require('crypto');
const norm = s => (s == null ? '' : String(s)).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const ESTADOS = ['pendiente', 'apartado', 'enviado', 'entregado'];

/** Huella estable: la misma fila en dos computadoras (ids distintos) da la misma huella. */
function huella(r) {
  const base = [r.fechaInicio, r.medicamento, r.cantidad, r.cliente, r.telefono, r.factura].map(norm).join('|');
  return crypto.createHash('sha256').update(base).digest('hex');
}
function validarRegistro(r) {
  const p = [];
  if (!r.medicamento) p.push('sin medicamento');
  if (!r.cliente) p.push('sin cliente');
  if (!r.fechaInicio || !/^\d{4}-\d{2}-\d{2}$/.test(r.fechaInicio)) p.push('fecha de inicio inválida');
  if (!ESTADOS.includes(r.estado)) p.push('estado desconocido');
  return p;
}
/** existentes = Set de huellas ya en la BD. */
function analizar(paquetes, existentes = new Set(), empleadosBD = []) {
  const vistos = new Map(), nuevos = [], duplicadosEnArchivos = [], yImportados = [], incompletos = [];
  for (const p of paquetes) for (const r of (p.records || [])) {
    const h = huella(r);
    if (existentes.has(h)) { yImportados.push(r); continue; }
    if (vistos.has(h)) { duplicadosEnArchivos.push(r); continue; }
    const prob = validarRegistro(r);
    if (prob.length) incompletos.push({ registro: r, problemas: prob });
    vistos.set(h, r); nuevos.push({ ...r, huella: h });
  }
  const nombresBD = new Set(empleadosBD.map(e => norm(e.nombre)));
  const sinCoincidencia = [...new Set(nuevos.map(r => r.dependiente).filter(Boolean))].filter(n => !nombresBD.has(norm(n)));
  // historicoEntregados: el MAYOR entre paquetes; nunca se suman.
  const historico = Math.max(0, ...paquetes.map(p => Number(p.historicoEntregados) || 0));
  return { nuevos, duplicadosEnArchivos, yImportados, incompletos, sinCoincidencia, historico };
}
module.exports = { norm, huella, validarRegistro, analizar };
