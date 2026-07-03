#!/usr/bin/env bash
# ==========================================================================
# Crea el cronjob de Cloud Scheduler que ejecuta la verificacion en vivo
# diariamente contra el servicio desplegado (crea una tarea de prueba en
# ClickUp, postea a Slack de prueba, verifica y limpia).
#
# Requisitos: gcloud autenticado, el servicio ya desplegado, y el secreto
# WEBHOOK_SECRET en Secret Manager.
#
# Uso:
#   PROJECT_ID=mi-proyecto REGION=us-central1 \
#   SERVICE_URL=https://llamadas-atencion-api-xxxx.run.app \
#   ./scripts/setup-scheduler.sh
# ==========================================================================
set -euo pipefail

: "${PROJECT_ID:?Define PROJECT_ID}"
: "${REGION:=us-central1}"
: "${SERVICE_URL:?Define SERVICE_URL (URL del Cloud Run)}"
: "${SCHEDULE:=0 9 * * *}"           # 09:00 todos los dias (hora del scheduler)
: "${TZ_NAME:=America/La_Paz}"
JOB_NAME="${JOB_NAME:-llamadas-atencion-live-verify}"

echo "Leyendo WEBHOOK_SECRET de Secret Manager..."
SECRET="$(gcloud secrets versions access latest --secret=WEBHOOK_SECRET --project "$PROJECT_ID")"

URI="${SERVICE_URL%/}/internal/live-verify"

# Crear o actualizar el job.
if gcloud scheduler jobs describe "$JOB_NAME" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Actualizando job existente $JOB_NAME..."
  ACTION=update
else
  echo "Creando job $JOB_NAME..."
  ACTION=create
fi

gcloud scheduler jobs "$ACTION" http "$JOB_NAME" \
  --project "$PROJECT_ID" \
  --location "$REGION" \
  --schedule "$SCHEDULE" \
  --time-zone "$TZ_NAME" \
  --uri "$URI" \
  --http-method POST \
  --headers "X-Webhook-Secret=${SECRET}" \
  --attempt-deadline 120s

echo "Listo. El job '$JOB_NAME' llamara a $URI segun: '$SCHEDULE' ($TZ_NAME)."
echo "Puedes probarlo ahora con:  gcloud scheduler jobs run $JOB_NAME --location $REGION --project $PROJECT_ID"
