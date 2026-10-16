'use strict';
// API de Medicamentos Pendientes. ESTADO: escrito, sin ejecutar (faltan dependencias y PostgreSQL en el entorno de desarrollo).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), https = require('https');
const express = require('express'), { Pool } = require('pg'), argon = require('@node-rs/argon2');
const L = require('../shared/logic');

const CFG_DIR = process.env.MEDPEND_CONFIG || path.join(process.env.ProgramData || '.', 'MedicamentosPendientes');
const cfg = JSON.parse(fs.readFileSync(path.join(CFG_DIR, 'config.json'), 'utf8'));
const pool = new Pool({ host: '127.0.0.1', port: cfg.dbPort, user: 'medpend_app', password: cfg.dbPassword, database: 'medpend', max: 10 });
const q = (t, p) => pool.query(t, p);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ahora = () => new Date();

class HttpError extends Error { constructor(s, m, extra) { super(m); this.status = s; this.extra = extra; } }
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

/* ---------- utilidades ---------- */
const SEL = `id, medicamento, cantidad, cliente, telefono, factura, dependiente_id, dependiente_texto, autorizado,
  to_char(fecha_inicio,'YYYY-MM-DD') fi, to_char(fecha_entrega_est,'YYYY-MM-DD') fe, hora_est, estado,
  to_char(fecha_entrega_real,'YYYY-MM-DD') fr, observaciones, version, modificado_en`;
const fmt = r => ({ id: r.id, medicamento: r.medicamento, cantidad: r.cantidad, cliente: r.cliente, telefono: r.telefono,
  factura: r.factura, dependiente: r.dependiente_texto, dependienteId: r.dependiente_id, autorizado: r.autorizado,
  fechaInicio: r.fi, fechaEntrega: r.fe || '', hora: r.hora_est, estado: r.estado, fechaEntregaReal: r.fr || '',
  observaciones: r.observaciones, version: r.version, modificadoEn: r.modificado_en });
const txt = (v, max = 500) => (v == null ? '' : String(v)).trim().slice(0, max);
function limpiar(b, parcial) {
  const o = {};
  for (const k of ['medicamento', 'cantidad', 'cliente', 'telefono', 'factura', 'autorizado', 'hora', 'observaciones', 'dependiente'])
    if (!parcial || b[k] !== undefined) o[k] = txt(b[k], k === 'observaciones' ? 2000 : 200);
  for (const k of ['fechaInicio', 'fechaEntrega', 'fechaEntregaReal'])
    if (!parcial || b[k] !== undefined) { const v = txt(b[k], 10); if (v && !RE_FECHA.test(v)) throw new HttpError(400, `Fecha inválida en ${k}`); o[k] = v; }
  if (b.estado !== undefined) { if (!L.ESTADOS.includes(b.estado)) throw new HttpError(400, 'Estado no válido'); o.estado = b.estado; }
  if (b.dependienteId !== undefined) o.dependienteId = b.dependienteId || null;
  return o;
}
async function auditar(uid, accion, entidad, id, antes, despues) {
  await q('INSERT INTO auditoria(usuario_id,accion,entidad,entidad_id,antes,despues) VALUES($1,$2,$3,$4,$5,$6)',
    [uid, accion, entidad, id, antes ? JSON.stringify(antes) : null, despues ? JSON.stringify(despues) : null]);
}
const clientes = new Set();
const difundir = (tipo, datos) => { const m = `event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`; for (const r of clientes) r.write(m); };

/* ---------- autenticación ---------- */
const ROL = { administrador: 3, supervisor: 2, dependiente: 1 };
const auth = wrap(async (req, _res, next) => {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!t) throw new HttpError(401, 'Sesión requerida');
  const { rows } = await q(`SELECT u.id, u.nombre, u.usuario, u.rol FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id
    WHERE s.token_hash=$1 AND NOT s.revocada AND s.expira_en>now() AND u.activo`, [sha(t)]);
  if (!rows[0]) throw new HttpError(401, 'Sesión caducada');
  req.user = rows[0]; next();
});
const minRol = r => (req, _res, next) => ROL[req.user.rol] >= ROL[r] ? next() : next(new HttpError(403, 'No tiene permiso para esta acción'));
const validarClave = c => { if (typeof c !== 'string' || c.length < 10) throw new HttpError(400, 'La contraseña debe tener al menos 10 caracteres'); };

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((_req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); next(); });

app.get('/api/health', wrap(async (_req, res) => {
  await q('SELECT 1'); const { rows } = await q('SELECT count(*)::int n FROM usuarios');
  res.json({ ok: true, app: 'medicamentos-pendientes', version: '0.1.0', configurado: rows[0].n > 0, huella: cfg.certFingerprint || null });
}));

app.post('/api/setup', wrap(async (req, res) => {
  const { rows } = await q('SELECT count(*)::int n FROM usuarios');
  if (rows[0].n > 0) throw new HttpError(409, 'El sistema ya está configurado');
  const nombre = txt(req.body.nombre, 100), usuario = txt(req.body.usuario, 50).toLowerCase(), farmacia = txt(req.body.farmacia, 120);
  if (!nombre || !usuario) throw new HttpError(400, 'Nombre y usuario son obligatorios');
  validarClave(req.body.password);
  const hash = await argon.hash(req.body.password);
  const u = await q('INSERT INTO usuarios(nombre,usuario,password_hash,rol) VALUES($1,$2,$3,$4) RETURNING id', [nombre, usuario, hash, 'administrador']);
  if (farmacia) await q(`INSERT INTO configuracion VALUES('farmacia',$1) ON CONFLICT (clave) DO UPDATE SET valor=$1`, [JSON.stringify(farmacia)]);
  await auditar(u.rows[0].id, 'setup', 'usuario', u.rows[0].id, null, { usuario });
  res.status(201).json({ ok: true });
}));

app.post('/api/login', wrap(async (req, res) => {
  const usuario = txt(req.body.usuario, 50).toLowerCase();
  const { rows } = await q('SELECT * FROM usuarios WHERE usuario=$1 AND activo', [usuario]);
  const u = rows[0];
  if (u && u.bloqueado_hasta && u.bloqueado_hasta > ahora()) throw new HttpError(429, 'Demasiados intentos. Espere unos minutos.');
  const ok = u && typeof req.body.password === 'string' && await argon.verify(u.password_hash, req.body.password).catch(() => false);
  if (!ok) {
    if (u) await q(`UPDATE usuarios SET intentos_fallidos=intentos_fallidos+1,
      bloqueado_hasta=CASE WHEN intentos_fallidos+1>=5 THEN now()+interval '10 minutes' ELSE NULL END WHERE id=$1`, [u.id]);
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }
  await q('UPDATE usuarios SET intentos_fallidos=0, bloqueado_hasta=NULL WHERE id=$1', [u.id]);
  const token = crypto.randomBytes(32).toString('base64url');
  await q(`INSERT INTO sesiones(usuario_id,token_hash,expira_en) VALUES($1,$2,now()+interval '12 hours')`, [u.id, sha(token)]);
  await auditar(u.id, 'login', 'usuario', u.id);
  res.json({ token, usuario: { id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol } });
}));

app.use('/api', auth);
app.post('/api/logout', wrap(async (req, res) => {
  await q('UPDATE sesiones SET revocada=true WHERE token_hash=$1', [sha((req.headers.authorization || '').replace(/^Bearer /, ''))]);
  res.json({ ok: true });
}));
app.get('/api/yo', (req, res) => res.json(req.user));

/* ---------- medicamentos ---------- */
app.get('/api/medicamentos', wrap(async (req, res) => {
  const p = [], w = ['NOT eliminado'];
  if (req.query.estado && L.ESTADOS.includes(req.query.estado)) { p.push(req.query.estado); w.push(`estado=$${p.length}`); }
  if (req.query.activos === '1') w.push(`estado<>'entregado'`);
  const s = txt(req.query.q, 100).toLowerCase();
  if (s) { p.push('%' + s.replace(/[%_\\]/g, '\\$&') + '%'); w.push(`lower(cliente||' '||medicamento||' '||dependiente_texto||' '||factura||' '||telefono) LIKE $${p.length}`); }
  const { rows } = await q(`SELECT ${SEL} FROM medicamentos WHERE ${w.join(' AND ')} ORDER BY fecha_inicio LIMIT 5000`, p);
  res.json(L.ordenar(rows.map(fmt), L.hoyISO()));
}));

async function nombreEmpleado(id) { if (!id) return null; const { rows } = await q('SELECT nombre FROM empleados WHERE id=$1', [id]); return rows[0] ? rows[0].nombre : null; }

app.post('/api/medicamentos', wrap(async (req, res) => {
  const d = limpiar(req.body);
  if (!d.medicamento || !d.cliente) throw new HttpError(400, 'Medicamento y cliente son obligatorios');
  d.fechaInicio = d.fechaInicio || L.hoyISO(); d.estado = d.estado || 'pendiente';
  const dep = (await nombreEmpleado(d.dependienteId)) || d.dependiente || '';
  const f = L.aplicarCambioEstado({ estado: d.estado, fechaEntregaReal: d.fechaEntregaReal }, d.estado);
  const { rows } = await q(`INSERT INTO medicamentos(medicamento,cantidad,cliente,telefono,factura,dependiente_id,dependiente_texto,autorizado,
    fecha_inicio,fecha_entrega_est,hora_est,estado,fecha_entrega_real,observaciones,creado_por,modificado_por)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING ${SEL}`,
    [d.medicamento, d.cantidad, d.cliente, d.telefono, d.factura, d.dependienteId || null, dep, d.autorizado, d.fechaInicio,
     d.fechaEntrega || null, d.hora, d.estado, f.fechaEntregaReal || null, d.observaciones, req.user.id]);
  const r = fmt(rows[0]); await auditar(req.user.id, 'crear', 'medicamento', r.id, null, r); difundir('medicamento', r);
  res.status(201).json(r);
}));

app.put('/api/medicamentos/:id', wrap(async (req, res) => {
  const ver = Number(req.body.version); if (!Number.isInteger(ver)) throw new HttpError(400, 'Falta la versión del registro');
  const act = (await q(`SELECT ${SEL} FROM medicamentos WHERE id=$1 AND NOT eliminado`, [req.params.id])).rows[0];
  if (!act) throw new HttpError(404, 'Registro no encontrado');
  const antes = fmt(act), d = limpiar(req.body, true);
  let m = { ...antes, ...d };
  if (d.estado !== undefined && d.estado !== antes.estado) m = L.aplicarCambioEstado(m, d.estado);
  else if (m.estado === 'entregado' && !m.fechaEntregaReal) m.fechaEntregaReal = L.hoyISO();
  const dep = d.dependienteId !== undefined ? ((await nombreEmpleado(d.dependienteId)) || m.dependiente) : m.dependiente;
  if (!m.medicamento || !m.cliente) throw new HttpError(400, 'Medicamento y cliente son obligatorios');
  const { rows } = await q(`UPDATE medicamentos SET medicamento=$1,cantidad=$2,cliente=$3,telefono=$4,factura=$5,dependiente_id=$6,dependiente_texto=$7,
    autorizado=$8,fecha_inicio=$9,fecha_entrega_est=$10,hora_est=$11,estado=$12,fecha_entrega_real=$13,observaciones=$14,
    version=version+1,modificado_en=now(),modificado_por=$15 WHERE id=$16 AND version=$17 AND NOT eliminado RETURNING ${SEL}`,
    [m.medicamento, m.cantidad, m.cliente, m.telefono, m.factura, d.dependienteId !== undefined ? (d.dependienteId || null) : antes.dependienteId, dep,
     m.autorizado, m.fechaInicio, m.fechaEntrega || null, m.hora, m.estado, m.fechaEntregaReal || null, m.observaciones, req.user.id, req.params.id, ver]);
  if (!rows[0]) throw new HttpError(409, 'Otro usuario modificó este registro. Revise los cambios y vuelva a intentarlo.', { actual: antes });
  const r = fmt(rows[0]); await auditar(req.user.id, 'editar', 'medicamento', r.id, antes, r); difundir('medicamento', r);
  res.json(r);
}));

app.delete('/api/medicamentos/:id', minRol('administrador'), wrap(async (req, res) => {
  const { rows } = await q(`UPDATE medicamentos SET eliminado=true,version=version+1,modificado_en=now(),modificado_por=$2 WHERE id=$1 AND NOT eliminado RETURNING id`, [req.params.id, req.user.id]);
  if (!rows[0]) throw new HttpError(404, 'Registro no encontrado');
  await auditar(req.user.id, 'eliminar', 'medicamento', req.params.id); difundir('eliminado', { id: req.params.id });
  res.json({ ok: true });
}));

/* ---------- empleados (nunca se borran: se desactivan) ---------- */
app.get('/api/empleados', wrap(async (_req, res) => {
  const { rows } = await q('SELECT id,nombre,cargo,telefono,notas,activo FROM empleados ORDER BY lower(nombre)'); res.json(rows);
}));
app.post('/api/empleados', minRol('supervisor'), wrap(async (req, res) => {
  const nombre = txt(req.body.nombre, 100); if (!nombre) throw new HttpError(400, 'El nombre es obligatorio');
  try {
    const { rows } = await q('INSERT INTO empleados(nombre,cargo,telefono,notas) VALUES($1,$2,$3,$4) RETURNING *', [nombre, txt(req.body.cargo, 80), txt(req.body.telefono, 40), txt(req.body.notas, 500)]);
    await auditar(req.user.id, 'crear', 'empleado', rows[0].id, null, rows[0]); difundir('empleado', rows[0]); res.status(201).json(rows[0]);
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'Ya existe un empleado con ese nombre'); throw e; }
}));
app.put('/api/empleados/:id', minRol('supervisor'), wrap(async (req, res) => {
  const { rows } = await q(`UPDATE empleados SET nombre=COALESCE($2,nombre),cargo=COALESCE($3,cargo),telefono=COALESCE($4,telefono),notas=COALESCE($5,notas),activo=COALESCE($6,activo) WHERE id=$1 RETURNING *`,
    [req.params.id, req.body.nombre && txt(req.body.nombre, 100), req.body.cargo != null ? txt(req.body.cargo, 80) : null, req.body.telefono != null ? txt(req.body.telefono, 40) : null, req.body.notas != null ? txt(req.body.notas, 500) : null, typeof req.body.activo === 'boolean' ? req.body.activo : null]);
  if (!rows[0]) throw new HttpError(404, 'Empleado no encontrado');
  await auditar(req.user.id, 'editar', 'empleado', rows[0].id, null, rows[0]); difundir('empleado', rows[0]); res.json(rows[0]);
}));

/* ---------- estadísticas, usuarios, auditoría ---------- */
app.get('/api/estadisticas', wrap(async (_req, res) => {
  const { rows } = await q(`SELECT estado, to_char(fecha_inicio,'YYYY-MM-DD') fi, to_char(fecha_entrega_est,'YYYY-MM-DD') fe FROM medicamentos WHERE NOT eliminado`);
  const hist = Number((await q(`SELECT valor FROM configuracion WHERE clave='historico_entregados'`)).rows[0]?.valor || 0);
  const lista = rows.map(r => ({ estado: r.estado, fechaInicio: r.fi }));
  const hoy = L.hoyISO(), s = L.estadisticas(lista, hist, hoy);
  const limite = new Date(Date.parse(hoy + 'T00:00:00Z') + 2 * 86400000).toISOString().slice(0, 10);
  s.proximos = rows.filter(r => r.estado !== 'entregado' && r.fe && r.fe >= hoy && r.fe <= limite).length;
  res.json(s);
}));
app.get('/api/usuarios', minRol('administrador'), wrap(async (_req, res) => {
  res.json((await q('SELECT id,nombre,usuario,rol,activo FROM usuarios ORDER BY nombre')).rows);
}));
app.post('/api/usuarios', minRol('administrador'), wrap(async (req, res) => {
  const usuario = txt(req.body.usuario, 50).toLowerCase(), nombre = txt(req.body.nombre, 100);
  if (!usuario || !nombre || !ROL[req.body.rol]) throw new HttpError(400, 'Datos incompletos');
  validarClave(req.body.password);
  try {
    const { rows } = await q('INSERT INTO usuarios(nombre,usuario,password_hash,rol) VALUES($1,$2,$3,$4) RETURNING id,nombre,usuario,rol,activo', [nombre, usuario, await argon.hash(req.body.password), req.body.rol]);
    await auditar(req.user.id, 'crear', 'usuario', rows[0].id, null, rows[0]); res.status(201).json(rows[0]);
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'Ese usuario ya existe'); throw e; }
}));
app.put('/api/usuarios/:id', minRol('administrador'), wrap(async (req, res) => {
  if (req.params.id === req.user.id && (req.body.activo === false || (req.body.rol && req.body.rol !== 'administrador'))) throw new HttpError(400, 'No puede quitarse su propio acceso de administrador');
  if (req.body.password) { validarClave(req.body.password); await q('UPDATE usuarios SET password_hash=$2 WHERE id=$1', [req.params.id, await argon.hash(req.body.password)]); await q('UPDATE sesiones SET revocada=true WHERE usuario_id=$1', [req.params.id]); }
  const { rows } = await q('UPDATE usuarios SET rol=COALESCE($2,rol),activo=COALESCE($3,activo) WHERE id=$1 RETURNING id,nombre,usuario,rol,activo', [req.params.id, ROL[req.body.rol] ? req.body.rol : null, typeof req.body.activo === 'boolean' ? req.body.activo : null]);
  if (!rows[0]) throw new HttpError(404, 'Usuario no encontrado');
  if (rows[0].activo === false) await q('UPDATE sesiones SET revocada=true WHERE usuario_id=$1', [rows[0].id]);
  await auditar(req.user.id, 'editar', 'usuario', rows[0].id, null, rows[0]); res.json(rows[0]);
}));
app.get('/api/auditoria', minRol('supervisor'), wrap(async (req, res) => {
  const lim = Math.min(Number(req.query.limite) || 200, 1000);
  res.json((await q('SELECT a.id,a.fecha,u.usuario,a.accion,a.entidad,a.entidad_id FROM auditoria a LEFT JOIN usuarios u ON u.id=a.usuario_id ORDER BY a.id DESC LIMIT $1', [lim])).rows);
}));

/* ---------- tiempo real (SSE) ---------- */
app.get('/api/eventos', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', Connection: 'keep-alive' }); res.flushHeaders();
  res.write('event: listo\ndata: {}\n\n'); clientes.add(res);
  const hb = setInterval(() => res.write(': latido\n\n'), 25000);
  req.on('close', () => { clearInterval(hb); clientes.delete(res); });
});

app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  console.error(new Date().toISOString(), err); res.status(500).json({ error: 'Error interno del servidor' });
});

https.createServer({ pfx: fs.readFileSync(path.join(CFG_DIR, 'servidor.pfx')), passphrase: cfg.pfxPassword }, app)
  .listen(cfg.apiPort || 8443, '0.0.0.0', () => console.log('API lista en el puerto', cfg.apiPort || 8443));
setInterval(() => q(`DELETE FROM sesiones WHERE expira_en<now()-interval '7 days'`).catch(() => {}), 3600000);
