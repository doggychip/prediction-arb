import type { Config } from "drizzle-kit";

export default {
  schema: "./shared/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_PATH || "data/platform.db",
  },
} satisfies Config;
