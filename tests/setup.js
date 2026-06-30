/**
 * tests/setup.js — Vitest global setup
 *
 * Loads .env.local before any test module is evaluated, so env-dependent
 * module-level initialisers (e.g. `const stripe = process.env.STRIPE_SECRET_KEY
 * ? new Stripe(...) : null`) see the correct values.
 *
 * Referenced in vitest.config.js → test.setupFiles.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(__dirname, '../.env.local') });
