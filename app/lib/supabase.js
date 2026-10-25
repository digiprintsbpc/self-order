'use strict';
/**
 * lib/supabase.js — klien REST Supabase minimal.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service_role, server-side saja).
 * Semua helper mengembalikan { ok, status, data } — TIDAK PERNAH melempar,
 * jadi pemanggil wajib memeriksa ok (pelajaran: jangan telan error tulis).
 */

const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';

function configured() {
  return !!(BASE && KEY);
}

async function sb(path, opts = {}) {
  try {
    const res = await fetch(BASE + '/rest/v1' + path, {
      method: opts.method || 'GET',
      headers: {
        apikey: KEY,
        Authorization: 'Bearer ' + KEY,
        'Content-Type': 'application/json',
        ...(opts.prefer ? { Prefer: opts.prefer } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e.message };
  }
}

const get = (path) => sb(path);
const post = (path, body) => sb(path, { method: 'POST', body, prefer: 'return=representation' });
const patch = (path, body) => sb(path, { method: 'PATCH', body, prefer: 'return=representation' });
const del = (path) => sb(path, { method: 'DELETE', prefer: 'return=representation' });

module.exports = { configured, get, post, patch, del };
