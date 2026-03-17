/**
 * Helper script: Generate an RSA key pair for Kalshi API authentication.
 * Usage: npm run generate-key
 *
 * Generates:
 *   - kalshi_private_key.pem (keep secret, set KALSHI_PRIVATE_KEY_PATH to this file)
 *   - kalshi_public_key.pem (upload to Kalshi API settings)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../src/logger.js';

const logger = createLogger('generate-key');

function main() {
  const outputDir = process.cwd();
  const privateKeyPath = path.join(outputDir, 'kalshi_private_key.pem');
  const publicKeyPath = path.join(outputDir, 'kalshi_public_key.pem');

  // Check if keys already exist
  if (fs.existsSync(privateKeyPath)) {
    logger.error(`Private key already exists at ${privateKeyPath}. Remove it first to regenerate.`);
    process.exit(1);
  }

  logger.info('Generating 4096-bit RSA key pair...');

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });

  logger.info(`Private key written to: ${privateKeyPath}`);
  logger.info(`Public key written to: ${publicKeyPath}`);
  logger.info('');
  logger.info('Next steps:');
  logger.info('1. Upload the public key to your Kalshi account settings');
  logger.info('2. Set KALSHI_PRIVATE_KEY_PATH in your .env file');
  logger.info('3. Keep the private key secret — do not commit it to version control');
}

main();
