#!/usr/bin/env bash
set -euo pipefail

OUT_FILE="/tmp/certbot-dns-challenge.txt"
READY_FILE="/tmp/certbot-dns-ready"

cat > "${OUT_FILE}" <<EOF
domain=${CERTBOT_DOMAIN}
record=_acme-challenge.${CERTBOT_DOMAIN}
type=TXT
value=${CERTBOT_VALIDATION}
EOF

echo
echo "DNS challenge is ready."
echo "Record: _acme-challenge.${CERTBOT_DOMAIN}"
echo "Type: TXT"
echo "Value: ${CERTBOT_VALIDATION}"
echo
echo "Add the TXT record in DNS, then create file ${READY_FILE} to continue."

for _ in $(seq 1 14400); do
  if [[ -f "${READY_FILE}" ]]; then
    rm -f "${READY_FILE}"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for ${READY_FILE}" >&2
exit 1
