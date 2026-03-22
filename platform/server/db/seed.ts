import "dotenv/config";
import { nanoid } from "nanoid";
import { hash } from "argon2";
import { db } from "./index.js";
import { creators, agents, subscriptions, reviews } from "../../shared/schema.js";

async function seed() {
  console.log("Seeding database...");

  // Create demo creators
  const creator1Id = nanoid();
  const creator2Id = nanoid();
  const userId = nanoid();

  const pw = await hash("password123");

  db.insert(creators)
    .values([
      {
        id: creator1Id,
        name: "Prediction Labs",
        email: "admin@predictionlabs.io",
        passwordHash: pw,
        bio: "Building real-time prediction market infrastructure",
        verified: true,
      },
      {
        id: creator2Id,
        name: "DataForge AI",
        email: "hello@dataforge.ai",
        passwordHash: pw,
        bio: "Enterprise-grade data analysis agents",
        verified: true,
      },
      {
        id: userId,
        name: "Demo User",
        email: "demo@example.com",
        passwordHash: pw,
        bio: "Just exploring the platform",
      },
    ])
    .run();

  // Create demo agents
  const agent1Id = nanoid();
  const agent2Id = nanoid();
  const agent3Id = nanoid();
  const agent4Id = nanoid();

  db.insert(agents)
    .values([
      {
        id: agent1Id,
        creatorId: creator1Id,
        name: "Arb Scanner",
        slug: "arb-scanner",
        description:
          "Real-time arbitrage detection across Kalshi and Polymarket prediction markets.",
        longDescription:
          "Monitors thousands of matched market pairs across prediction platforms. Detects price discrepancies, calculates net spreads after fees, and provides actionable trade signals with confidence scores.",
        category: "trading",
        tags: JSON.stringify(["arbitrage", "prediction-markets", "kalshi", "polymarket"]),
        endpointUrl: "http://localhost:3001/api/scan",
        pricing: "usage",
        pricePerCall: 0.01,
        status: "active",
        rateLimit: 60,
        version: "1.0.0",
        schema: JSON.stringify({
          input: { type: "object", properties: { minSpread: { type: "number" } } },
          output: { type: "object", properties: { opportunities: { type: "array" } } },
        }),
      },
      {
        id: agent2Id,
        creatorId: creator1Id,
        name: "Market Matcher",
        slug: "market-matcher",
        description:
          "Fuzzy matching engine to find equivalent markets across different prediction platforms.",
        category: "analysis",
        tags: JSON.stringify(["matching", "nlp", "prediction-markets"]),
        endpointUrl: "http://localhost:3001/api/match",
        pricing: "free",
        status: "active",
        rateLimit: 30,
        version: "1.0.0",
      },
      {
        id: agent3Id,
        creatorId: creator2Id,
        name: "Sentiment Analyzer",
        slug: "sentiment-analyzer",
        description:
          "Analyzes social media and news sentiment for any topic, returning a -1 to 1 sentiment score.",
        category: "nlp",
        tags: JSON.stringify(["sentiment", "twitter", "news", "nlp"]),
        endpointUrl: "http://localhost:3002/api/sentiment",
        pricing: "monthly",
        monthlyPrice: 29.99,
        status: "active",
        rateLimit: 100,
        version: "2.1.0",
      },
      {
        id: agent4Id,
        creatorId: creator2Id,
        name: "PDF Extractor",
        slug: "pdf-extractor",
        description:
          "Extracts structured data from PDFs using vision models. Tables, forms, and free text.",
        category: "data",
        tags: JSON.stringify(["pdf", "extraction", "vision", "ocr"]),
        endpointUrl: "http://localhost:3002/api/extract",
        pricing: "usage",
        pricePerCall: 0.05,
        status: "active",
        rateLimit: 20,
        version: "1.3.0",
      },
    ])
    .run();

  // Demo subscriptions
  db.insert(subscriptions)
    .values([
      { id: nanoid(), userId, agentId: agent1Id, plan: "usage" },
      { id: nanoid(), userId, agentId: agent3Id, plan: "monthly" },
    ])
    .run();

  // Demo reviews
  db.insert(reviews)
    .values([
      {
        id: nanoid(),
        userId,
        agentId: agent1Id,
        rating: 5,
        comment: "Found real arbitrage opportunities within the first hour. Incredible.",
      },
      {
        id: nanoid(),
        userId,
        agentId: agent3Id,
        rating: 4,
        comment: "Great sentiment analysis, wish it supported more languages.",
      },
    ])
    .run();

  console.log("Seeded: 3 creators, 4 agents, 2 subscriptions, 2 reviews");
  console.log("\nDemo login: demo@example.com / password123");
}

seed().catch(console.error);
