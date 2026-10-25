'use strict';
/**
 * lib/payinaja.js — klien PayinAja QRIS, API key diberikan per panggilan
 * (satu aplikasi melayani banyak usaha; setiap usaha memakai key miliknya).
 * Pola sama dengan yang terbukti di bot toko Digiprint.
 */

const CREATE_URL = 'https://payinaja.com/api/v1/qris/create2';
const CHECK_URL = (trxId) => `https://payinaja.com/api/v1/transaction/${encodeURIComponent(trxId)}`;

async function createQRIS(apiKey, amount, reference_id, customer_name = 'Pelanggan') {
  if (!apiKey) return { ok: false, error: 'API key PayinAja usaha ini belum diisi' };
  try {
    const res = await fetch(CREATE_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: parseInt(amount, 10),
        reference_id,
        customer_name: customer_name || 'Pelanggan',
        customer_phone: '',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.success || data.status) {
      const d = data.data || {};
      return {
        ok: true,
        trx_id: d.trx_id || d.payinaja_trx_id || reference_id,
        qr_image_url: d.qris_image_url || d.qr_image_url || d.image_url || null,
      };
    }
    return { ok: false, error: data.message || 'Ditolak server PayinAja' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkTransaction(apiKey, trx_id) {
  if (!apiKey) return { ok: false, error: 'API key PayinAja usaha ini belum diisi' };
  try {
    const res = await fetch(CHECK_URL(trx_id), {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });
    const data = await res.json().catch(() => ({}));
    if (data.success || data.status) {
      const d = data.data || {};
      const st = String(d.status || '').toLowerCase();
      return { ok: true, paid: st === 'success', status: d.status || st };
    }
    return { ok: false, error: data.message || 'Transaksi tidak ditemukan' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { createQRIS, checkTransaction };
