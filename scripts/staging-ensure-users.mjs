import { appendFileSync } from 'node:fs';

const required = [
  'SUPABASE_URL',
  'SUPABASE_ADMIN_KEY',
  'STAGING_OWNER_A_EMAIL',
  'STAGING_OWNER_A_PASSWORD',
  'STAGING_OWNER_B_EMAIL',
  'STAGING_OWNER_B_PASSWORD',
];

for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required staging environment variable: ${name}`);
}

const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
const adminKey = process.env.SUPABASE_ADMIN_KEY;

async function adminRequest(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('apikey', adminKey);
  headers.set('Authorization', `Bearer ${adminKey}`);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${baseUrl}/auth/v1/admin/${path}`, { ...init, headers });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const code = data?.code ?? data?.error_code ?? response.status;
    throw new Error(`Supabase Auth admin request failed (${code})`);
  }
  return data;
}

function normalizeUser(payload) {
  return payload?.user ?? payload;
}

async function listUsers() {
  const payload = await adminRequest('users?page=1&per_page=1000');
  return Array.isArray(payload?.users) ? payload.users : [];
}

async function ensureUser(users, email, password, fullName) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = users.find((user) => String(user?.email ?? '').toLowerCase() === normalizedEmail);
  const body = JSON.stringify({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  const payload = existing
    ? await adminRequest(`users/${existing.id}`, { method: 'PUT', body })
    : await adminRequest('users', { method: 'POST', body });

  const user = normalizeUser(payload);
  if (!user?.id) throw new Error(`Supabase Auth admin response did not contain a user id for ${fullName}`);
  return user.id;
}

const users = await listUsers();
const ownerA = await ensureUser(
  users,
  process.env.STAGING_OWNER_A_EMAIL,
  process.env.STAGING_OWNER_A_PASSWORD,
  'Staging Owner A',
);
const ownerB = await ensureUser(
  users,
  process.env.STAGING_OWNER_B_EMAIL,
  process.env.STAGING_OWNER_B_PASSWORD,
  'Staging Owner B',
);

if (ownerA === ownerB) throw new Error('Staging owner accounts resolved to the same Auth user');

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `owner_a=${ownerA}\nowner_b=${ownerB}\n`, 'utf8');
}

console.log(`Staging Auth owners are ready: ${ownerA} / ${ownerB}`);
