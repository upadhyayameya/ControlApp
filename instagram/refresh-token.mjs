#!/usr/bin/env node
// Refreshes a long-lived Instagram access token (valid 60 days; refreshable once
// it is at least 24h old). Prints the new token to stdout so the workflow can
// store it back into the IG_ACCESS_TOKEN secret.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'config.json'), 'utf8'));
const token = process.env.IG_ACCESS_TOKEN;
if (!token) {
  console.error('IG_ACCESS_TOKEN is not set');
  process.exit(1);
}
const url = new URL(`${config.graphHost}/refresh_access_token`);
url.searchParams.set('grant_type', 'ig_refresh_token');
url.searchParams.set('access_token', token);
const res = await fetch(url);
const json = await res.json().catch(() => ({}));
if (!res.ok || !json.access_token) {
  console.error(`Refresh failed: ${json.error?.message || `HTTP ${res.status}`}`);
  process.exit(1);
}
console.error(`Token refreshed; expires in ${Math.round(json.expires_in / 86400)} days.`);
process.stdout.write(json.access_token);
