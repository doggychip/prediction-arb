// ─── API request/response types ───

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  bio?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface PublishAgentRequest {
  name: string;
  slug: string;
  description: string;
  longDescription?: string;
  category: string;
  tags?: string[];
  endpointUrl: string;
  healthCheckUrl?: string;
  docsUrl?: string;
  pricing: "free" | "usage" | "monthly";
  pricePerCall?: number;
  monthlyPrice?: number;
  rateLimit?: number;
  schema?: Record<string, unknown>;
}

export interface AgentListItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  tags: string[];
  pricing: string;
  pricePerCall: number;
  monthlyPrice: number;
  status: string;
  version: string;
  creator: {
    id: string;
    name: string;
    verified: boolean;
  };
  avgRating: number;
  reviewCount: number;
  subscriberCount: number;
}

export interface AgentCallRequest {
  input: Record<string, unknown>;
}

export interface AgentCallResponse {
  output: unknown;
  latencyMs: number;
  usage: {
    callsToday: number;
    callsRemaining: number;
  };
}

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export const CATEGORIES = [
  "trading",
  "analysis",
  "data",
  "automation",
  "nlp",
  "vision",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];
