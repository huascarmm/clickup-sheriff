-- Esquema MySQL de clickup-sheriff (reemplaza Firestore).
-- Roles/permisos siguen viviendo en Firebase Auth (custom claims); esto es
-- solo el almacenamiento de datos de negocio.
--
-- person_key NO tiene FK: ademas de las personas reales (tabla people), el
-- resolver genera claves sinteticas para asignados desconocidos
-- (p.ej. "sin_asignado", "qa:Fulano", "assignee:Fulano"), que nunca existen
-- en people. Igual que en Firestore, esa referencia no se fuerza.

CREATE TABLE IF NOT EXISTS people (
  person_key       VARCHAR(191) PRIMARY KEY,
  nombre_visible    VARCHAR(191) NOT NULL DEFAULT '',
  qa_string         VARCHAR(191) NOT NULL DEFAULT '',
  clickup_user_id   VARCHAR(64)  NOT NULL DEFAULT '',
  clickup_username  VARCHAR(191) NOT NULL DEFAULT '',
  clickup_email     VARCHAR(191) NOT NULL DEFAULT '',
  login_email       VARCHAR(191) NOT NULL DEFAULT '',
  slack_user_id     VARCHAR(64)  NOT NULL DEFAULT '',
  activo            BOOLEAN      NOT NULL DEFAULT TRUE,
  notas             TEXT         NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Documento unico config/settings de Firestore -> fila unica id=1.
CREATE TABLE IF NOT EXISTS settings (
  id                        TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,
  qa_field_id               VARCHAR(64)  NOT NULL DEFAULT '',
  status_change_field_id    VARCHAR(64)  NOT NULL DEFAULT '',
  plazo_field_id             VARCHAR(64)  NOT NULL DEFAULT '',
  qa_field_label             VARCHAR(191) NOT NULL DEFAULT '',
  status_change_field_label  VARCHAR(191) NOT NULL DEFAULT '',
  plazo_field_label          VARCHAR(191) NOT NULL DEFAULT '',
  qa_status_name             VARCHAR(191) NOT NULL DEFAULT '',
  fixing_qa_status_name      VARCHAR(191) NOT NULL DEFAULT '',
  ignored_statuses           JSON         NULL,
  qa_hours_limit             INT          NOT NULL DEFAULT 36,
  fixing_hours_limit         INT          NOT NULL DEFAULT 36,
  overdue_weekly_tolerance   INT          NOT NULL DEFAULT 2,
  reset_period_months        INT          NOT NULL DEFAULT 3,
  timezone                   VARCHAR(64)  NOT NULL DEFAULT 'America/La_Paz',
  slack_channel_name         VARCHAR(191) NOT NULL DEFAULT '',
  slack_channel_id           VARCHAR(64)  NOT NULL DEFAULT '',
  plazo_hour_default         INT          NOT NULL DEFAULT 4,
  plazo_minute_default       INT          NOT NULL DEFAULT 0,
  test_clickup_list_id       VARCHAR(64)  NOT NULL DEFAULT '',
  test_slack_channel_id      VARCHAR(64)  NOT NULL DEFAULT '',
  test_assignee_person_key   VARCHAR(191) NOT NULL DEFAULT '',
  updated_at                 DATETIME     NULL,
  updated_by                 VARCHAR(191) NULL,
  CONSTRAINT settings_single_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS attention_calls (
  id                            VARCHAR(191) PRIMARY KEY,
  timestamp_local                VARCHAR(64)  NOT NULL DEFAULT '',
  timestamp_ms                   BIGINT       NOT NULL,
  date_key                       VARCHAR(16)  NOT NULL DEFAULT '',
  week_key                       VARCHAR(16)  NOT NULL DEFAULT '',
  period_key                     VARCHAR(16)  NOT NULL DEFAULT '',
  task_id                        VARCHAR(64)  NOT NULL DEFAULT '',
  task_name                      VARCHAR(512) NOT NULL DEFAULT '',
  task_url                       VARCHAR(512) NOT NULL DEFAULT '',
  current_status                 VARCHAR(191) NOT NULL DEFAULT '',
  alert_type                     ENUM('QA_36H','FIXING_QA_36H','ATRASO_PLAZO','MANUAL') NOT NULL,
  person_key                     VARCHAR(191) NOT NULL,
  person_name                    VARCHAR(191) NOT NULL DEFAULT '',
  slack_user_id                  VARCHAR(64)  NOT NULL DEFAULT '',
  reason                         TEXT         NULL,
  hours_elapsed                  DECIMAL(10,2) NOT NULL DEFAULT 0,
  due_date_local                 VARCHAR(64)  NOT NULL DEFAULT '',
  status_change_local            VARCHAR(64)  NOT NULL DEFAULT '',
  tolerance                      VARCHAR(32)  NOT NULL DEFAULT '',
  is_tolerance                   BOOLEAN      NOT NULL DEFAULT FALSE,
  weekly_count_after              INT          NOT NULL DEFAULT 0,
  period_attention_count_after    INT          NULL,
  slack_ok                       BOOLEAN      NOT NULL DEFAULT FALSE,
  slack_ts                       VARCHAR(64)  NOT NULL DEFAULT '',
  slack_error                    TEXT         NULL,
  message                        TEXT         NULL,
  origin                         ENUM('webhook','manual') NULL,
  created_by_email               VARCHAR(191) NULL,
  comment                        TEXT         NULL,
  deleted                        BOOLEAN      NOT NULL DEFAULT FALSE,
  deleted_by                     VARCHAR(191) NULL,
  deleted_reason                 TEXT         NULL,
  deleted_at                     DATETIME     NULL,
  claim_id                       VARCHAR(36)  NULL,
  created_at                     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_calls_person_week_deleted (person_key, week_key, deleted),
  KEY idx_calls_person_period_deleted (person_key, period_key, deleted),
  KEY idx_calls_period (period_key),
  KEY idx_calls_timestamp_ms (timestamp_ms),
  KEY idx_calls_claim_id (claim_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS claims (
  id                     VARCHAR(36)  PRIMARY KEY,
  call_id                 VARCHAR(191) NOT NULL,
  task_id                 VARCHAR(64)  NOT NULL DEFAULT '',
  task_name               VARCHAR(512) NOT NULL DEFAULT '',
  task_url                VARCHAR(512) NOT NULL DEFAULT '',
  alert_type              ENUM('QA_36H','FIXING_QA_36H','ATRASO_PLAZO','MANUAL') NOT NULL,
  call_timestamp_local     VARCHAR(64)  NOT NULL DEFAULT '',
  person_key              VARCHAR(191) NOT NULL,
  person_name             VARCHAR(191) NOT NULL DEFAULT '',
  requested_by_email       VARCHAR(191) NOT NULL,
  requested_by_name        VARCHAR(191) NOT NULL DEFAULT '',
  requested_by_slack_id     VARCHAR(64)  NOT NULL DEFAULT '',
  justification           TEXT         NOT NULL,
  status                  ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at_ms             BIGINT       NOT NULL,
  resolved_by_email         VARCHAR(191) NULL,
  resolved_at_ms             BIGINT       NULL,
  resolution_message        TEXT         NULL,
  CONSTRAINT fk_claims_call FOREIGN KEY (call_id) REFERENCES attention_calls(id),
  KEY idx_claims_call_status (call_id, status),
  KEY idx_claims_created_at_ms (created_at_ms),
  KEY idx_claims_requested_by (requested_by_email),
  KEY idx_claims_person_key (person_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_log (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  action       VARCHAR(64)  NOT NULL,
  claim_id     VARCHAR(36)  NULL,
  call_id      VARCHAR(191) NULL,
  person_key   VARCHAR(191) NULL,
  by_email     VARCHAR(191) NOT NULL,
  reason       TEXT         NULL,
  comment      TEXT         NULL,
  message      TEXT         NULL,
  snapshot     JSON         NULL,
  at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_at (at),
  KEY idx_audit_claim_id (claim_id),
  KEY idx_audit_call_id (call_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS system_logs (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  severity       ENUM('info','warn','error') NOT NULL,
  kind           VARCHAR(64)  NOT NULL,
  message        TEXT         NULL,
  task_id        VARCHAR(64)  NULL,
  action         VARCHAR(64)  NULL,
  status         VARCHAR(191) NULL,
  context        JSON         NULL,
  timestamp_ms    BIGINT       NOT NULL,
  timestamp_local VARCHAR(64)  NOT NULL DEFAULT '',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_logs_timestamp_ms (timestamp_ms),
  KEY idx_logs_severity (severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS system_errors (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  message     TEXT     NULL,
  stack       TEXT     NULL,
  context     JSON     NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_errors_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
