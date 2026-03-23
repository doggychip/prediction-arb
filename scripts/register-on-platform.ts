/**
 * Registers the arb engine as an agent on the AgentForge platform.
 *
 * Usage:
 *   PLATFORM_URL=http://localhost:4000 \
 *   PLATFORM_EMAIL=admin@predictionlabs.io \
 *   PLATFORM_PASSWORD=password123 \
 *   npx tsx scripts/register-on-platform.ts
 */

const PLATFORM_URL = process.env.PLATFORM_URL || 'http://localhost:4000';
const EMAIL = process.env.PLATFORM_EMAIL || 'admin@predictionlabs.io';
const PASSWORD = process.env.PLATFORM_PASSWORD || 'password123';
const ENGINE_URL = process.env.ENGINE_URL || 'http://localhost:3001';

async function main() {
  console.log(`Registering arb engine on platform at ${PLATFORM_URL}...`);

  // 1. Login (or register)
  let token: string;
  try {
    const loginRes = await fetch(`${PLATFORM_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });

    if (!loginRes.ok) {
      // Try registering
      console.log('Login failed, attempting registration...');
      const regRes = await fetch(`${PLATFORM_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Prediction Labs',
          email: EMAIL,
          password: PASSWORD,
          bio: 'Building real-time prediction market infrastructure',
        }),
      });
      if (!regRes.ok) throw new Error(`Registration failed: ${await regRes.text()}`);
      const data = await regRes.json();
      token = data.token;
      console.log(`Registered as ${data.user.name}`);
    } else {
      const data = await loginRes.json();
      token = data.token;
      console.log(`Logged in as ${data.user.name}`);
    }
  } catch (err) {
    console.error('Auth failed:', (err as Error).message);
    process.exit(1);
  }

  // 2. Register the arb scanner agent
  const agentPayload = {
    name: 'Arb Scanner',
    slug: 'arb-scanner',
    description:
      'Real-time arbitrage detection across Kalshi and Polymarket prediction markets. Returns live opportunities with net spreads after fees.',
    longDescription: `Monitors thousands of matched market pairs across Kalshi and Polymarket prediction platforms in real-time via WebSocket.

Features:
- Token-based fuzzy matching to find equivalent markets across platforms
- Two-direction spread analysis (Kalshi YES + Poly NO, and vice versa)
- Fee-aware calculations (accounts for Kalshi's 7% profit fee)
- Polarity validation to filter false positives
- Sub-second detection via WebSocket price feeds

Input: { "minSpread": 2, "limit": 10 }
Output: Array of arbitrage opportunities with prices, strategy, and net spread.`,
    category: 'trading',
    tags: ['arbitrage', 'prediction-markets', 'kalshi', 'polymarket', 'real-time'],
    endpointUrl: `${ENGINE_URL}/api/scan`,
    healthCheckUrl: `${ENGINE_URL}/health`,
    docsUrl: '',
    pricing: 'usage',
    pricePerCall: 0.01,
    rateLimit: 60,
    schema: {
      input: {
        type: 'object',
        properties: {
          minSpread: { type: 'number', description: 'Minimum net spread in cents (default: 0)' },
          limit: { type: 'number', description: 'Max results to return (default: 20, max: 100)' },
        },
      },
      output: {
        type: 'object',
        properties: {
          opportunities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                pairId: { type: 'string' },
                kalshiTicker: { type: 'string' },
                polymarketId: { type: 'string' },
                strategy: { type: 'string', enum: ['kalshi_yes_poly_no', 'kalshi_no_poly_yes'] },
                bestSpreadCents: { type: 'number' },
                netSpreadCents: { type: 'number' },
                estimatedFeesCents: { type: 'number' },
                detectedAt: { type: 'string' },
              },
            },
          },
          total: { type: 'number' },
          engine: {
            type: 'object',
            properties: {
              pairsTracked: { type: 'number' },
              uptime: { type: 'number' },
            },
          },
        },
      },
    },
  };

  try {
    const res = await fetch(`${PLATFORM_URL}/api/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(agentPayload),
    });

    if (!res.ok) {
      const err = await res.json();
      if (err.code === 'CONFLICT') {
        console.log('Agent "arb-scanner" already registered on platform.');
      } else {
        throw new Error(err.error);
      }
    } else {
      const data = await res.json();
      console.log(`Agent registered: ${data.slug} (id: ${data.id})`);
    }
  } catch (err) {
    console.error('Failed to register agent:', (err as Error).message);
    process.exit(1);
  }

  console.log('\nDone! The arb engine is now available on the platform.');
  console.log(`  Platform: ${PLATFORM_URL}/api/agents/arb-scanner`);
  console.log(`  Engine:   ${ENGINE_URL}/api/scan`);
  console.log(`\nUsers can subscribe and call it via:`);
  console.log(`  curl -X POST ${PLATFORM_URL}/api/call/arb-scanner \\`);
  console.log(`    -H "X-API-Key: af_their_key" \\`);
  console.log(`    -d '{"input": {"minSpread": 2}}'`);
}

main().catch(console.error);
