# Llamadas de atencion — ClickUp → Slack (Cloud Run + Firestore)

Sistema de "llamadas de atencion" migrado desde Google Apps Script + Google Sheets
a una arquitectura moderna: **API en Cloud Run**, datos en **Firestore** (base con
nombre `llamadas-atencion`) y **panel de administracion en Firebase Hosting**.

Reemplaza los dos sistemas del Apps Script original:

1. **Llamadas de atencion.** Cuando una tarea de ClickUp se atrasa (QA/FIXING QA
   con mas de 36 h, o vencimiento de plazo), se envia una alerta a Slack. Aplica
   tolerancia semanal (los primeros N son avisos; luego, llamada formal) y lleva
   un contador trimestral de llamadas formales por persona.
2. **Validador de plazo (`validateDueTime`).** Marca un checkbox en ClickUp cuando
   el vencimiento tiene una hora personalizada (distinta de la hora default).

## Por que esta migracion resuelve los bugs historicos

Los problemas que costaban depuracion en Sheets (tareas duplicadas, contador
semanal con saltos por race conditions, fallos transitorios) **desaparecen de
raiz** por diseno:

- **Idempotencia por ID determinista.** Cada llamada se guarda con el id
  `{fecha}_{taskId}_{tipo}`. Si ClickUp dispara el webhook varias veces el mismo
  dia para la misma tarea, todas apuntan al mismo documento: una sola llamada.
- **Contadores en transaccion.** El conteo semanal/trimestral se lee y escribe
  dentro de una transaccion de Firestore, que reintenta ante contencion. Se acabo
  el `LockService` + `flush()` + backoff manual. Las secuencias salen 1,2,3,4…
  aun con rafagas simultaneas.

## Estructura

```
src/            API (TypeScript, Express)
  domain/       logica pura y testeable (reglas, tiempo, tolerancia, parsing)
  services/     clickup, slack, people, attention (transaccion), validateDueTime
  webhooks/     endpoints que recibe ClickUp
  admin/        API del panel (auth + roles)
scripts/        seed.ts, set-claims.ts
seeds/          people.json (equipo), config.json (defaults)
test/           unit / integration (emulador) / e2e
web/            panel de administracion (React + Vite + Firebase Auth)
Dockerfile      imagen para Cloud Run
firebase.json   Hosting con rewrite /api → Cloud Run + Firestore
```

## Requisitos

- Node 20+
- Una cuenta de Google Cloud / Firebase con facturacion habilitada
- `gcloud` y `firebase-tools` (`npm i -g firebase-tools`)

## Puesta en marcha (una sola vez)

### 1. Proyecto y base de datos

```bash
# Elige tu proyecto
gcloud config set project TU_PROJECT_ID

# Habilita APIs
gcloud services enable run.googleapis.com firestore.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com

# Crea la base Firestore CON NOMBRE (no la (default))
gcloud firestore databases create --database=llamadas-atencion \
  --location=nam5
```

Copia `.firebaserc.example` a `.firebaserc` y pon tu `PROJECT_ID`.

### 2. Secretos en Secret Manager

Estos valores nunca van al codigo ni al panel. **Rota los tokens que estaban en
el Apps Script viejo** (estuvieron en texto plano): genera un token nuevo de
ClickUp y reinstala/rota el bot token de Slack.

```bash
printf '%s' 'pk_TU_TOKEN_NUEVO_CLICKUP'  | gcloud secrets create CLICKUP_TOKEN   --data-file=-
printf '%s' 'xoxb-TU_TOKEN_NUEVO_SLACK'  | gcloud secrets create SLACK_BOT_TOKEN --data-file=-
printf '%s' 'un-secreto-largo-y-random'  | gcloud secrets create WEBHOOK_SECRET  --data-file=-
```

El bot de Slack necesita los scopes `chat:write` y `channels:read`
(y `groups:read` si el canal es privado), y debe estar invitado al canal.

### 3. Reglas e indices de Firestore

```bash
firebase deploy --only firestore --project TU_PROJECT_ID
```

### 4. Usuarios y roles del panel

Los usuarios se crean **manualmente** en la consola de Firebase
(Authentication → Users → Add user, con correo y contrasena). Luego asigna el rol
con custom claims:

```bash
export FIREBASE_PROJECT_ID=TU_PROJECT_ID
export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json  # clave con permiso sobre Auth

npm run set-claims -- jefe@empresa.com   superadmin
npm run set-claims -- lider@empresa.com  admin
```

- **admin**: ve llamadas, detalle, stats, cuentas y configuracion (solo lectura).
- **superadmin**: ademas elimina llamadas (con motivo → auditoria), edita cuentas
  y edita configuracion.

Ademas, define la allowlist de correos como variable de entorno del servicio
(`ADMIN_EMAILS`), como cerrojo extra.

### 5. Seed (opcional)

El sistema arranca con base vacia usando defaults. Si quieres precargar el equipo
y la config inicial:

```bash
# contra Firestore real
FIREBASE_PROJECT_ID=TU_PROJECT_ID npm run seed

# solo personas / solo config
npm run seed -- --people-only
npm run seed -- --config-only --force
```

## Despliegue continuo (GitHub)

El workflow `.github/workflows/deploy.yml` corre tests en cada push/PR y despliega
al hacer push a `main`.

Configura en el repo (Settings → Secrets and variables → Actions):

**Secrets**
- `GCP_PROJECT_ID`
- `WIF_PROVIDER` y `WIF_SERVICE_ACCOUNT` (Workload Identity Federation, recomendado;
  ver la guia de `google-github-actions/auth`). Alternativa: usar una clave JSON.

**Variables**
- `ADMIN_EMAILS` (correos admin separados por coma)
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
  `VITE_FIREBASE_APP_ID` (config publica del cliente Firebase)

Cada push a `main` reconstruye la API (Cloud Run leyendo los secretos de Secret
Manager), y redepliega reglas/indices de Firestore y el panel en Hosting.

## Despliegue manual (alternativa)

```bash
# API
gcloud run deploy llamadas-atencion-api \
  --source . --region us-central1 --allow-unauthenticated \
  --set-env-vars FIREBASE_PROJECT_ID=TU_PROJECT_ID,FIRESTORE_DATABASE_ID=llamadas-atencion,ADMIN_EMAILS=jefe@empresa.com \
  --set-secrets CLICKUP_TOKEN=CLICKUP_TOKEN:latest,SLACK_BOT_TOKEN=SLACK_BOT_TOKEN:latest,WEBHOOK_SECRET=WEBHOOK_SECRET:latest

# Panel
cd web && npm ci && npm run build && cd ..
firebase deploy --only firestore,hosting --project TU_PROJECT_ID
```

## Conectar ClickUp

### 1. Obten la URL real del servicio de Cloud Run

Los webhooks van **directo a Cloud Run**, no a Firebase Hosting (Hosting solo
reescribe `/api/**` hacia Cloud Run para el panel; `/webhooks/**` no pasa por ahi,
asi que usar el dominio de Hosting para el webhook da 404).

```bash
gcloud run services describe llamadas-atencion-api \
  --region us-central1 --format='value(status.url)'
```

Eso imprime algo como `https://llamadas-atencion-api-xxxxxxxx-uc.a.run.app`. La URL
completa del webhook de llamadas de atencion es esa mas `/webhooks/clickup`.

### 2. Configura el webhook en ClickUp (Automate → Webhooks → Create webhook)

Con la migracion, la configuracion se **simplifica**: ya no hace falta mandar
`task_id`, `assignees`, `task_link`, `task_name`, `status_name` ni `due_date_text`
como parametros de URL.

- El webhook es **solo un disparador**: el backend ignora cualquier dato de estado
  que traiga y siempre vuelve a consultar la tarea fresca a la API de ClickUp (ver
  seccion siguiente). Solo necesita saber que tarea revisar.
- ClickUp's action **Call webhook** siempre manda un cuerpo JSON con `payload.id`
  (el id de la tarea), sin que haya que configurar nada extra. El backend ya lo lee
  de ahi automaticamente.
- Los "Url Parameters" de ClickUp son **estaticos** (la documentacion oficial lo
  dice explicitamente: *"Unlike the dynamic variables, URL parameters are
  static"*), y el selector actual de variables dinamicas de ClickUp solo ofrece
  Task ID, Task Name, Task Description, Creator Username, Creator Email, Due Date,
  Start Date, Date Created, Date Updated y Date Closed — **no** incluye
  `assignees`, `status` ni `task_link`. Si tu configuracion anterior usaba
  placeholders como `{assignees}` o `{status_status}` en los Url Parameters, es
  probable que ya no se sustituyan y se envien como texto literal. Como el sistema
  nuevo no los necesita, la solucion es simplemente quitarlos.

**Configuracion recomendada:**

| Campo | Valor |
|---|---|
| URL | `https://<tu-servicio>.run.app/webhooks/clickup` (sin nada mas) |
| Casillas de campos dinamicos (Task ID, Task Name, etc.) | Ninguna marcada — no hacen falta |
| Headers | `Content-type: application/json` (por defecto) + opcional `X-Webhook-Secret: EL_WEBHOOK_SECRET` (ver mas abajo) |
| Url Parameters | `action` = `attentionCheck` (y si no usas el header, tambien `secret` = `EL_WEBHOOK_SECRET`) |

Para el **validador de plazo**, la misma URL pero **sin** el parametro `action`
(o con cualquier valor distinto de `attentionCheck`).

### 3. Como se manda el secret: header (recomendado) o URL

El sistema acepta el `WEBHOOK_SECRET` de dos formas:

- **Header `X-Webhook-Secret`** (recomendado). ClickUp trata los valores de
  headers como sensibles: una vez guardados, no se pueden volver a ver ni editar
  en claro, a diferencia de los Url Parameters que quedan visibles en la
  configuracion del webhook. Agregalo en la seccion **Headers** con clave
  `X-Webhook-Secret` (usa **Add** para headers personalizados).
- **Parametro `secret` en la URL** (compatibilidad con configuraciones previas).
  Sigue funcionando, pero queda visible en la pantalla de configuracion.

Si usas el header, no hace falta el parametro `secret` en la URL (y viceversa). Si
mandas ambos, se usa el header.

> ⚠️ Si alguna vez tu `WEBHOOK_SECRET` quedo expuesto en texto plano (por ejemplo,
> compartido fuera de un canal seguro), **rotalo**: genera un valor nuevo, actualizalo
> en Secret Manager y en la configuracion del webhook en ClickUp al mismo tiempo.

Manten los mismos triggers/horarios que ya tenias configurados en las
automatizaciones (Schedule, condiciones de estado, etc.) — lo unico que cambia es
la URL, los headers y los parametros del webhook en si.

### El webhook es solo un disparador (verificacion de estado)

El sistema **no confia en el estado que trae el webhook**. ClickUp puede mandar el
webhook con retraso (los reintentos duran hasta **1 hora y 15 minutos** segun la
documentacion oficial), reintentarlo, o dispararlo cuando la tarea ya cambio de
estado (por ejemplo, cuando ya paso a **PRODUCTION**). Por eso, al recibir un
webhook de `attentionCheck`, el sistema toma unicamente el `task_id` y **vuelve a
consultar el estado actual de la tarea a la API de ClickUp**, y evalua las reglas
contra ese estado fresco:

- Si la tarea ya esta en **PRODUCTION** (u otro estado terminal), no se emite nada.
- Si ya no cumple la regla de 36 h (porque cambio de estado y el reloj se reinicio),
  no se emite nada.
- Si no se puede verificar el estado (falla la API de ClickUp), **tampoco se emite**:
  se prefiere no alertar antes que emitir una llamada de atencion sobre datos sin
  confirmar.

Los estados terminales que nunca generan alerta se configuran en
`ignoredStatuses` (por defecto `production, done, closed, completado`) y se pueden
ajustar desde el panel de configuracion.

### Campo del revisor (REVISOR)

El revisor de una tarea se lee de un **campo personalizado** de ClickUp. Su nombre
es configurable en el panel (Configuracion → *Campo del revisor*), en el ajuste
`qaFieldName` (por defecto `REVISOR`). Es distinto del **estado** `QA`
(`qaStatusName`): el estado se sigue llamando QA; lo que cambio de nombre fue el
campo del revisor. Si renombras el campo en ClickUp, basta con actualizarlo en el
panel; no hay que tocar codigo.

## Desarrollo local

```bash
# API + emulador de Firestore
npm install
firebase emulators:start --only firestore   # en otra terminal
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=demo-llamadas npm run dev

# Panel
cd web && npm install && cp .env.example .env   # completa los VITE_*
npm run dev   # proxy de /api hacia localhost:8080
```

## Tests

```bash
npm run test:unit          # logica pura, sin dependencias externas
npm run test:integration   # idempotencia, contadores y re-emision (requiere emulador)
npm run test:e2e           # webhook completo por HTTP (requiere emulador)

# Todo junto con el emulador levantado automaticamente:
firebase emulators:exec --only firestore --project demo-llamadas \
  "npm run test:integration && npm run test:e2e"
```

Los tests de integracion/e2e se **saltan** automaticamente si el emulador no esta
disponible, para no bloquear una corrida rapida de las unitarias. Requieren
**Java 21+** (firebase-tools ya no soporta versiones anteriores).

Entre los flujos verificados estan los dos que mas facilmente fallan:
- **Idempotencia** y **contadores** consistentes bajo rafagas concurrentes.
- **Re-emision tras borrado**: si una llamada fue eliminada (por error o por un
  test) y la condicion sigue vigente el mismo dia, un nuevo webhook la vuelve a
  emitir y a enviar a Slack (no se queda bloqueada por el documento eliminado).

### Smoke tests en vivo (base y URLs reales)

Para verificar el sistema **ya desplegado**, contra ClickUp real, Firestore real y
Slack real, hay una suite aparte que no corre por defecto:

```bash
# Verificacion SEGURA (dry-run: no escribe en Firestore ni postea a Slack).
# Hace el fetch real de la tarea a ClickUp y evalua las reglas.
SMOKE_API_URL=https://<tu-servicio>.run.app \
SMOKE_WEBHOOK_SECRET=<tu-secret> \
SMOKE_TASK_ID=<id-de-tarea-real> \
FIREBASE_PROJECT_ID=<tu-proyecto> \
npm run test:smoke

# Verificacion COMPLETA (ESCRIBE en Firestore y postea a Slack de verdad):
# incluye el flujo de re-emision tras borrado y limpia el documento al final.
... SMOKE_ALLOW_WRITES=1 npm run test:smoke
```

El modo dry-run tambien esta disponible como endpoint, agregando `&dryRun=1` al
webhook de `attentionCheck`: devuelve que pasaria (si ameritaria llamada, a quien,
que tolerancia) sin ningun efecto. Hay ademas un workflow manual en GitHub Actions
(`Smoke (en vivo)`) que corre el dry-run contra el servicio desplegado.

## Modelo de datos (Firestore, base `llamadas-atencion`)

- `attention_calls/{fecha_taskId_tipo}` — cada llamada de atencion (idempotente).
- `people/{person_key}` — el equipo (reemplaza `config_personas`).
- `config/settings` — parametros editables desde el panel.
- `audit_log/{id}` — eliminaciones (quien, cuando, por que).
- `system_errors/{id}` — errores para diagnostico.

El cliente nunca accede a Firestore directo: las reglas lo bloquean y todo pasa
por la API con `firebase-admin`.

## Seguridad

- Tokens en Secret Manager, nunca en el codigo ni en la base.
- Webhooks protegidos por `?secret=` (comparado con `WEBHOOK_SECRET`).
- Panel protegido por ID token de Firebase + allowlist de correos + roles.
- Rota los tokens que estuvieron en el Apps Script original.
