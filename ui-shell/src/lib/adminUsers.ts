"use client";

import { getGatewayBaseUrl } from "@/lib/gateway";
import { getKeycloak } from "@/lib/keycloak";

export type AdminUserRole = {
  name: string;
  description: string;
};

export type AdminUser = {
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  position: string;
  enabled: boolean;
  roles: string[];
};

export type AdminUserForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: string;
  enabled: boolean;
  roles: string[];
};

export type AdminUserCreateResult = AdminUser & {
  temporary_password: string;
};

export type AdminUserCreateRequest = AdminUserForm & {
  sendEmail: boolean;
};

export type AdminUserPasswordResetRequest = {
  newPassword: string;
  temporary: boolean;
  sendEmail: boolean;
};

export type AdminUserPasswordResetResult = {
  user_id: string;
  email: string;
  temporary_password: string;
  email_sent: boolean;
};

export const EMPTY_ADMIN_USER_FORM: AdminUserForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  position: "",
  enabled: true,
  roles: [],
};

export function cloneForm(form: AdminUserForm): AdminUserForm {
  return {
    ...form,
    roles: [...form.roles],
  };
}

export function userToForm(user: AdminUser): AdminUserForm {
  return {
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    phone: user.phone || "",
    position: user.position || "",
    enabled: user.enabled,
    roles: [...(user.roles || [])],
  };
}

export function toggleRole(roles: string[], roleName: string): string[] {
  return roles.includes(roleName) ? roles.filter((item) => item !== roleName) : [...roles, roleName];
}

export function formToPayload(form: AdminUserForm) {
  return {
    first_name: form.firstName.trim(),
    last_name: form.lastName.trim(),
    email: form.email.trim().toLowerCase(),
    phone: form.phone.trim(),
    position: form.position.trim(),
    enabled: form.enabled,
    roles: [...form.roles].sort(),
  };
}

export function createRequestToPayload(form: AdminUserCreateRequest) {
  return {
    ...formToPayload(form),
    send_email: form.sendEmail,
  };
}

export function passwordResetToPayload(data: AdminUserPasswordResetRequest) {
  return {
    new_password: data.newPassword,
    temporary: data.temporary,
    send_email: data.sendEmail,
  };
}

function getToken(): string {
  const raw = (window as any).__hubcrmAccessToken;
  if (!raw) return "";
  const token = String(raw).trim();
  if (!token || token === "undefined" || token === "null") return "";
  return token;
}

async function authHeaders(forceRefresh = false): Promise<Record<string, string>> {
  let token = getToken();
  if (!token || forceRefresh) {
    try {
      const kc = await getKeycloak();
      try {
        await kc.updateToken(forceRefresh ? 0 : 30);
      } catch {
        // Backend will return a concrete auth error.
      }
      token = kc.token || "";
      if (token) {
        (window as any).__hubcrmAccessToken = token;
      }
    } catch {
      // Keep empty token.
    }
  }
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function adminUsersFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getGatewayBaseUrl();
  const requestInit = async (forceRefresh: boolean): Promise<RequestInit> => ({
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      ...(await authHeaders(forceRefresh)),
    },
  });

  let resp = await fetch(`${base}${path}`, await requestInit(false));
  if (resp.status === 401) {
    resp = await fetch(`${base}${path}`, await requestInit(true));
  }
  return resp;
}

export async function readError(resp: Response, fallback: string): Promise<string> {
  const body = (await resp.text().catch(() => "")).trim();
  return body ? `${fallback}: ${body}` : fallback;
}

export async function canManageUsers(): Promise<boolean> {
  const resp = await adminUsersFetch("/plugins/access/check/users.manage", { cache: "no-store" });
  if (!resp.ok) return false;
  return Boolean((await resp.json())?.allowed);
}
