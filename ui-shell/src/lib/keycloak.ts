import type Keycloak from "keycloak-js";

let _kc: Keycloak | null = null;
let _KeycloakFactory: ((cfg: any) => Keycloak) | null = null;
let _KeycloakFactoryPromise: Promise<(cfg: any) => Keycloak> | null = null;

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

function normalizeKeycloakExport(mod: any): any {
  // keycloak-js can be published/consumed as CJS or ESM; Next can wrap exports.
  // Try common shapes: default export, named Keycloak, nested default.
  const candidates = [
    mod?.default,
    mod,
    mod?.Keycloak,
    mod?.default?.Keycloak,
    mod?.default?.default,
  ];
  for (const c of candidates) {
    if (typeof c === "function") return c;
  }
  return null;
}

async function getKeycloakFactory(): Promise<(cfg: any) => Keycloak> {
  if (_KeycloakFactory) return _KeycloakFactory;
  if (_KeycloakFactoryPromise) return _KeycloakFactoryPromise;

  _KeycloakFactoryPromise = (async () => {
    const mod: any = await import("keycloak-js");
    const KeycloakExport = normalizeKeycloakExport(mod);
    if (!KeycloakExport) {
      throw new Error("Failed to load keycloak-js export");
    }

    const factory = (cfg: any): Keycloak => {
      // Prefer constructor form, fallback to callable form.
      try {
        return new (KeycloakExport as any)(cfg);
      } catch {
        return (KeycloakExport as any)(cfg);
      }
    };

    _KeycloakFactory = factory;
    return factory;
  })();

  return _KeycloakFactoryPromise;
}

export async function getKeycloak(): Promise<Keycloak> {
  if (typeof window === "undefined") {
    throw new Error("Keycloak can only be used on the client side");
  }
  if (_kc) return _kc;
  const cfg = getKeycloakConfig();
  const factory = await getKeycloakFactory();
  _kc = factory(cfg);
  return _kc;
}


