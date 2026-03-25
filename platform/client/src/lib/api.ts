const BASE = "/api";

let authToken: string | null = localStorage.getItem("token");

export function setToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem("token", token);
  } else {
    localStorage.removeItem("token");
  }
}

export function getToken(): string | null {
  return authToken;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }

  return res.json();
}

// Auth
export const auth = {
  register: (data: { name: string; email: string; password: string }) =>
    request<{ token: string; user: { id: string; name: string; email: string } }>(
      "/auth/register",
      { method: "POST", body: JSON.stringify(data) }
    ),
  login: (data: { email: string; password: string }) =>
    request<{ token: string; user: { id: string; name: string; email: string } }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify(data) }
    ),
  me: () =>
    request<{
      id: string;
      name: string;
      email: string;
      bio: string | null;
      avatarUrl: string | null;
      verified: boolean;
      emailVerified: boolean;
      createdAt: string;
      agentCount: number;
    }>("/auth/me"),
  updateProfile: (data: { name?: string; bio?: string; avatarUrl?: string }) =>
    request<{ ok: boolean }>("/auth/me", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    request<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  sendVerification: () =>
    request<{ ok: boolean; token?: string; message: string }>("/auth/verify-email/send", {
      method: "POST",
    }),
  confirmVerification: (token: string) =>
    request<{ ok: boolean; message: string }>("/auth/verify-email/confirm", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
};

// Agents
export const agentsApi = {
  list: (params?: { category?: string; q?: string; limit?: number; offset?: number }) => {
    const filtered = Object.fromEntries(
      Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== "")
    );
    const qs = new URLSearchParams(filtered as Record<string, string>).toString();
    return request<{ agents: any[]; total: number; limit: number; offset: number }>(
      `/agents${qs ? `?${qs}` : ""}`
    );
  },
  get: (slug: string) => request<any>(`/agents/${slug}`),
  create: (data: any) =>
    request<any>("/agents", { method: "POST", body: JSON.stringify(data) }),
  update: (slug: string, data: any) =>
    request<any>(`/agents/${slug}`, { method: "PATCH", body: JSON.stringify(data) }),
  mine: () => request<{ agents: any[] }>("/agents/mine"),
  usage: (slug: string) =>
    request<{
      totalCalls: number;
      calls24h: number;
      calls7d: number;
      avgLatencyMs: number;
      errorRate: number;
      estimatedRevenue: number;
      daily: { date: string; count: number; avgLatency: number; errors: number }[];
    }>(`/agents/mine/${slug}/usage`),
  setStatus: (slug: string, status: "active" | "suspended") =>
    request<{ ok: boolean; status: string }>(`/agents/${slug}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  remove: (slug: string) =>
    request<{ ok: boolean }>(`/agents/${slug}`, { method: "DELETE" }),
  review: (slug: string, data: { rating: number; comment?: string }) =>
    request<{ id: string; rating: number; comment: string | null; userName: string; createdAt: string }>(
      `/agents/${slug}/reviews`,
      { method: "POST", body: JSON.stringify(data) }
    ),
};

// Subscriptions
export const subscriptionsApi = {
  list: () => request<{ subscriptions: any[] }>("/subscriptions"),
  create: (agentId: string) =>
    request<any>("/subscriptions", {
      method: "POST",
      body: JSON.stringify({ agentId }),
    }),
  cancel: (id: string) =>
    request<any>(`/subscriptions/${id}`, { method: "DELETE" }),
};

// API Keys
export const keysApi = {
  list: () => request<{ keys: any[] }>("/keys"),
  create: (name: string) =>
    request<{ id: string; key: string; prefix: string }>("/keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  revoke: (id: string) => request<any>(`/keys/${id}`, { method: "DELETE" }),
};

// Notifications
export const notificationsApi = {
  list: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
    ).toString();
    return request<{ notifications: any[]; unreadCount: number }>(
      `/notifications${qs ? `?${qs}` : ""}`
    );
  },
  markRead: (id: string) =>
    request<{ ok: boolean }>(`/notifications/${id}/read`, { method: "PATCH" }),
  markAllRead: () =>
    request<{ ok: boolean }>("/notifications/read-all", { method: "POST" }),
  // Webhooks
  listWebhooks: () => request<{ webhooks: any[] }>("/notifications/webhooks"),
  createWebhook: (data: { url: string; events: string[] }) =>
    request<{ id: string; secret: string }>("/notifications/webhooks", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteWebhook: (id: string) =>
    request<{ ok: boolean }>(`/notifications/webhooks/${id}`, { method: "DELETE" }),
};

// Billing
export const billingApi = {
  get: () =>
    request<{ account: any; payments: any[]; stripeEnabled: boolean }>("/billing"),
  upgrade: (plan: string) =>
    request<{ ok: boolean; plan: string }>("/billing/upgrade", {
      method: "POST",
      body: JSON.stringify({ plan }),
    }),
  connect: () =>
    request<{ ok: boolean; connected: boolean }>("/billing/connect", { method: "POST" }),
  revenue: () =>
    request<{ agents: any[]; totalEstimatedMonthly: number }>("/billing/revenue"),
};

// Stats
export const statsApi = {
  get: () =>
    request<{ agents: number; creators: number; subscriptions: number }>(
      "/stats"
    ),
};
