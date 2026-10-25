'use strict';
/**
 * api/dapur.js — API layar dapur (KDS). Dilindungi PIN usaha.
 *   GET  ?tenant=<slug>&pin=<pin>            -> antrean order aktif hari ini
 *   POST { tenant, pin, order_id, status }   -> majukan status:
 *        dibayar -> dimasak -> siap -> selesai
 */
const data = require('../lib/data');

const TRANSISI = { dibayar: 'dimasak', dimasak: 'siap', siap: 'selesai' };

function kirim(res, code, obj) {
  res.status(code).json(obj);
}

async function bacaBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const tenant = await data.getTenantBySlug(String(req.query.tenant || ''));
      if (!tenant || tenant.pin !== String(req.query.pin || '')) {
        return kirim(res, 401, { ok: false, error: 'PIN salah atau usaha tidak ditemukan' });
      }
      const orders = await data.listKitchenOrders(tenant.id);
      return kirim(res, 200, { ok: true, orders });
    }

    if (req.method === 'POST') {
      const b = await bacaBody(req);
      const tenant = await data.getTenantBySlug(String(b.tenant || ''));
      if (!tenant || tenant.pin !== String(b.pin || '')) {
        return kirim(res, 401, { ok: false, error: 'PIN salah atau usaha tidak ditemukan' });
      }
      const order = await data.getOrder(String(b.order_id || ''));
      if (!order || order.tenant_id !== tenant.id) return kirim(res, 404, { ok: false, error: 'Pesanan tidak ditemukan' });
      const tujuan = String(b.status || '');
      if (TRANSISI[order.status] !== tujuan) {
        return kirim(res, 400, { ok: false, error: `Status tidak bisa berubah dari ${order.status} ke ${tujuan}` });
      }
      const upd = await data.patchOrder(order.id, { status: tujuan });
      if (!upd.ok) return kirim(res, 500, { ok: false, error: 'Gagal mengubah status — coba lagi' });
      return kirim(res, 200, { ok: true, order_id: order.id, status: tujuan });
    }

    return kirim(res, 405, { ok: false, error: 'Metode tidak didukung' });
  } catch (e) {
    return kirim(res, 500, { ok: false, error: e.message });
  }
};
