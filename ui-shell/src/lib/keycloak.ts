import Keycloak from "keycloak-js";

let _kc: Keycloak | null = null;

export type KeycloakConfig = {
  url: string;
  realm: string;
  clientId: string;
};

export function getKeycloakConfig(): KeycloakConfig {
  const url = process.env.NEXT_PUBLIC_KEYCLOAK_URL || "http://localhost:8081";
  const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "hubcrm";
  const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || "hubcrm-ui";
  return { url, realm, clientId };
}

export function getKeycloak(): Keycloak {
  if (_kc) return _kc;
  const cfg = getKeycloakConfig();
  _kc = new Keycloak(cfg);
  return _kc;
}


