'use strict';
// Lógica de negocio pura (sin dependencias). Zona horaria fija: America/Santo_Domingo.
const TZ = 'America/Santo_Domingo';
const ESTADOS = ['pendiente', 'apartado', 'enviado', 'entregado'];
const ESTADO_LABELS = { pendiente: 'Pendiente', apartado: 'Apartado', enviado: 'Enviado al tramo', entregado: 'Entregado' };

/** Fecha de hoy (YYYY-MM-DD) en Santo Domingo, sin pasar por UTC. */
function hoyISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function diasEntre(inicioISO, hoy = hoyISO()) {
  if (!inicioISO || !/^\d{4}-\d{2}-\d{2}$/.test(inicioISO)) return null;
  const [y1, m1, d1] = inicioISO.split('-').map(Number);
  const [y2, m2, d2] = hoy.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
/** 'ok' | 'ambar' (>=3 días) | 'roja' (>=7 días) | 'ninguna' (entregado o sin fecha) */
function nivelAlerta(estado, inicioISO, hoy) {
  if (estado === 'entregado') return 'ninguna';
  const d = diasEntre(inicioISO, hoy);
  if (d === null) return 'ninguna';
  return d >= 7 ? 'roja' : d >= 3 ? 'ambar' : 'ok';
}
/** Activos primero; dentro de cada grupo, más días de espera primero (regla original). */
function ordenar(lista, hoy) {
  return lista.slice().sort((a, b) => {
    const ea = a.estado === 'entregado', eb = b.estado === 'entregado';
    if (ea !== eb) return ea ? 1 : -1;
    return (diasEntre(b.fechaInicio, hoy) || 0) - (diasEntre(a.fechaInicio, hoy) || 0);
  });
}
/** Entregado fija la fecha real; al salir de entregado se limpia el campo (la auditoría conserva el histórico). */
function aplicarCambioEstado(reg, nuevo, hoy = hoyISO()) {
  if (!ESTADOS.includes(nuevo)) throw new Error('Estado no válido');
  const r = { ...reg, estado: nuevo };
  r.fechaEntregaReal = nuevo === 'entregado' ? (reg.fechaEntregaReal || hoy) : '';
  return r;
}
function buscar(lista, q) {
  q = (q || '').trim().toLowerCase();
  if (!q) return lista;
  return lista.filter(r => [r.cliente, r.medicamento, r.dependiente, r.factura, r.telefono].some(x => (x || '').toLowerCase().includes(q)));
}
/** Total histórico = historico (contador antiguo) + entregados presentes en la BD. */
function estadisticas(lista, historico = 0, hoy) {
  const act = lista.filter(r => r.estado !== 'entregado');
  const ent = lista.filter(r => r.estado === 'entregado').length;
  return {
    pendientes: lista.filter(r => r.estado === 'pendiente').length,
    apartados: lista.filter(r => r.estado === 'apartado').length,
    enviados: lista.filter(r => r.estado === 'enviado').length,
    entregados: ent,
    activos: act.length,
    urgentes: act.filter(r => (diasEntre(r.fechaInicio, hoy) ?? -1) >= 7).length,
    entregadosHistorico: historico + ent,
  };
}
module.exports = { TZ, ESTADOS, ESTADO_LABELS, hoyISO, diasEntre, nivelAlerta, ordenar, aplicarCambioEstado, buscar, estadisticas };
