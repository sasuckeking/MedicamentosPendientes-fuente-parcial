-- Medicamentos Pendientes · esquema inicial (PostgreSQL 14+)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE rol_usuario AS ENUM ('administrador','supervisor','dependiente');
CREATE TYPE estado_medicamento AS ENUM ('pendiente','apartado','enviado','entregado');

CREATE TABLE usuarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        text NOT NULL,
  usuario       text NOT NULL UNIQUE,
  password_hash text NOT NULL,            -- Argon2id, nunca texto plano
  rol           rol_usuario NOT NULL,
  activo        boolean NOT NULL DEFAULT true,
  intentos_fallidos int NOT NULL DEFAULT 0,
  bloqueado_hasta timestamptz,
  creado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sesiones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid NOT NULL REFERENCES usuarios(id),
  token_hash  text NOT NULL UNIQUE,
  expira_en   timestamptz NOT NULL,
  revocada    boolean NOT NULL DEFAULT false,
  creada_en   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE empleados (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre    text NOT NULL,
  cargo     text NOT NULL DEFAULT '',
  telefono  text NOT NULL DEFAULT '',
  notas     text NOT NULL DEFAULT '',
  activo    boolean NOT NULL DEFAULT true,   -- se desactiva, nunca se borra
  legacy_id text UNIQUE,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX empleados_nombre_uq ON empleados (lower(nombre));

CREATE TABLE medicamentos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medicamento        text NOT NULL,
  cantidad           text NOT NULL DEFAULT '',   -- texto: admite "2 cajas", "1/2"
  cliente            text NOT NULL DEFAULT '',
  telefono           text NOT NULL DEFAULT '',
  factura            text NOT NULL DEFAULT '',
  dependiente_id     uuid REFERENCES empleados(id),
  dependiente_texto  text NOT NULL DEFAULT '',   -- conserva el nombre original
  autorizado         text NOT NULL DEFAULT '',
  fecha_inicio       date NOT NULL,
  fecha_entrega_est  date,
  hora_est           text NOT NULL DEFAULT '',
  estado             estado_medicamento NOT NULL DEFAULT 'pendiente',
  fecha_entrega_real date,
  observaciones      text NOT NULL DEFAULT '',
  eliminado          boolean NOT NULL DEFAULT false,  -- eliminación lógica
  version            int NOT NULL DEFAULT 1,           -- control de concurrencia
  legacy_id          text,
  huella_importacion text UNIQUE,                      -- evita duplicar al reimportar
  creado_en          timestamptz NOT NULL DEFAULT now(),
  creado_por         uuid REFERENCES usuarios(id),
  modificado_en      timestamptz NOT NULL DEFAULT now(),
  modificado_por     uuid REFERENCES usuarios(id)
);
CREATE INDEX med_estado_idx ON medicamentos (estado) WHERE NOT eliminado;
CREATE INDEX med_inicio_idx ON medicamentos (fecha_inicio);
CREATE INDEX med_busqueda_idx ON medicamentos
  USING gin ((lower(cliente||' '||medicamento||' '||dependiente_texto||' '||factura||' '||telefono)) gin_trgm_ops);

CREATE TABLE auditoria (
  id         bigserial PRIMARY KEY,
  fecha      timestamptz NOT NULL DEFAULT now(),
  usuario_id uuid REFERENCES usuarios(id),
  accion     text NOT NULL,
  entidad    text NOT NULL,
  entidad_id text,
  antes      jsonb,
  despues    jsonb
);

CREATE TABLE configuracion (
  clave text PRIMARY KEY,
  valor jsonb NOT NULL
);
INSERT INTO configuracion VALUES ('historico_entregados','0'::jsonb),
                                 ('zona_horaria','"America/Santo_Domingo"'::jsonb);

CREATE TABLE importaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo_sha256 text NOT NULL UNIQUE,
  fecha timestamptz NOT NULL DEFAULT now(),
  usuario_id uuid REFERENCES usuarios(id),
  resumen jsonb NOT NULL
);
COMMIT;
