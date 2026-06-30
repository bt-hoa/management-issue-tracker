#!/usr/bin/env node
/**
 * One-time script to obtain a Google OAuth refresh token for hoa@bellairetower.com.
 *
 * Usage:
 *   node scripts/get-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>
 *
 * Then follow the printed instructions. After you paste the auth code,
 * the refresh token is printed — store it with:
 *   wrangler secret put GOOGLE_REFRESH_TOKEN
 */

import http from 'http';
import { createInterface } from 'readline';

const [,, clientId, clientSecret] = process.argv;
if (!clientId || !clientSecret) {
  console.error('Usage: node scripts/get-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

const REDIRECT_URI = 'http://localhost:9999/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth` +
  `?client_id=${encodeURIComponent(clientId)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('\n1. Open this URL in the hoa@bellairetower.com Chrome profile:\n');
console.log(authUrl);
console.log('\n2. Authorize the app. You will be redirected to localhost — waiting...\n');

// Spin up a local server to capture the redirect
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:9999');
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('No code received.');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Authorization complete! You can close this tab.</h1>');
  server.close();

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const data = await tokenRes.json();
  if (!data.refresh_token) {
    console.error('\nError — no refresh token returned:', JSON.stringify(data, null, 2));
    console.error('\nMake sure you added prompt=consent and the app is published to Production.');
    process.exit(1);
  }

  console.log('\n✓ Refresh token obtained!\n');
  console.log('Run this to store it:\n');
  console.log(`  wrangler secret put GOOGLE_REFRESH_TOKEN`);
  console.log('\nWhen prompted, paste this value:\n');
  console.log(data.refresh_token);
  process.exit(0);
});

server.listen(9999, '127.0.0.1', () => {});
