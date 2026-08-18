#!/usr/bin/env bash
# Genera una CA propia y un certificado de servidor firmado por ella para MySQL.
# Uso: ./generate-certs.sh mysql.midominio.com
set -euo pipefail
cd "$(dirname "$0")"

CN_SERVER="${1:?uso: ./generate-certs.sh <host-o-dominio-del-servidor>}"
DAYS=3650

# --- CA propia ---
openssl genrsa -out ca-key.pem 2048
openssl req -new -x509 -nodes -days "$DAYS" -key ca-key.pem -out ca.pem \
  -subj "/CN=llamadas-atencion-mysql-ca"

# --- Certificado de servidor, firmado por la CA ---
openssl req -newkey rsa:2048 -nodes -keyout server-key.pem -out server-req.pem \
  -subj "/CN=${CN_SERVER}"
openssl x509 -req -in server-req.pem -days "$DAYS" \
  -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out server-cert.pem

# openssl req -newkey escribe la key en formato PKCS#8 (BEGIN PRIVATE KEY);
# MySQL espera el formato tradicional PKCS#1 (BEGIN RSA PRIVATE KEY) y falla
# con "Unable to get private key" si no se convierte. En OpenSSL 3.x, "openssl
# rsa" ya NO convierte a PKCS#1 por defecto (a diferencia de 1.x): hace falta
# -traditional explicito.
openssl rsa -in server-key.pem -out server-key.pem -traditional

rm -f server-req.pem
chmod 600 ca-key.pem
# server-key.pem: 644 (no 600) porque mysqld corre como el usuario sin
# privilegios "mysql" dentro del contenedor, distinto del usuario del host
# que genera este archivo; con 600 mysqld no puede leerlo y falla con
# "Unable to get private key".
chmod 644 server-key.pem ca.pem server-cert.pem

echo
echo "Listo. Archivos generados en $(pwd):"
echo "  ca.pem          -> pegar en MYSQL_SSL_CA (o MYSQL_SSL_CA_PATH) del cliente"
echo "  server-cert.pem / server-key.pem -> montados por docker-compose.yml"
