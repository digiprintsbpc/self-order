'use strict';
/**
 * api/admin.js — API panel pemilik usaha. Dilindungi PIN usaha.
 *   GET  ?tenant=<slug>&pin=<pin>&action=ringkas|menu|meja
 *   POST { tenant, pin, action, ... }
 *     action: menu-save | menu-delete | meja-add | meja-delete | tenant-save
 * API key PayinAja tidak pernah dikirim balik utuh — hanya status terisi/belum.
 */
const data = require('../lib/data');

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
    const sumber = req.method === 'POST' ? await bacaBody(req) : req.query;
    const tenant = await data.getTenantBySlug(String(sumber.tenant || ''));
    if (!tenant || tenant.pin !== String(sumber.pin || '')) {
      return kirim(res, 401, { ok: false, error: 'PIN salah atau usaha tidak ditemukan' });
    }
    const action = String(sumber.action || '');

    if (req.method === 'GET') {
      if (action === 'ringkas') {
        const orders = await data.listOrdersToday(tenant.id);
        const lunas = orders.filter((o) => !['menunggu_bayar', 'batal'].includes(o.status));
        const menu = await data.listMenuAll(tenant.id);
        const meja = await data.listMeja(tenant.id);
        return kirim(res, 200, {
          ok: true,
          ringkas: {
            order_lunas: lunas.length,
            omzet: lunas.reduce((s, o) => s + Number(o.total || 0), 0),
            menunggu_bayar: orders.filter((o) => o.status === 'menunggu_bayar').length,
            jumlah_menu: menu.length,
            jumlah_meja: meja.length,
          },
          tenant: { slug: tenant.slug, nama: tenant.nama, payinaja_terisi: !!tenant.payinaja_api_key },
        });
      }
      if (action === 'menu') return kirim(res, 200, { ok: true, menu: await data.listMenuAll(tenant.id) });
      if (action === 'meja') return kirim(res, 200, { ok: true, meja: await data.listMeja(tenant.id) });
      return kirim(res, 400, { ok: false, error: 'Action tidak dikenal' });
    }

    if (req.method === 'POST') {
      if (action === 'menu-save') {
        const ekstra = Array.isArray(sumber.ekstra) ? sumber.ekstra : [];
        const r = await data.saveMenuItem(tenant.id, { ...sumber, ekstra });
        if (!r.ok) return kirim(res, 400, { ok: false, error: r.error });
        return kirim(res, 200, { ok: true, item: r.item });
      }
      if (action === 'menu-delete') {
        const r = await data.deleteMenuItem(tenant.id, String(sumber.id || ''));
        return kirim(res, r.ok ? 200 : 400, { ok: r.ok, error: r.ok ? undefined : 'Menu tidak ditemukan' });
      }
      if (action === 'meja-add') {
        const nomor = String(sumber.nomor || '').trim();
        if (!nomor) return kirim(res, 400, { ok: false, error: 'Nomor meja wajib diisi' });
        const r = await data.addMeja(tenant.id, nomor);
        if (!r.ok) return kirim(res, 400, { ok: false, error: r.error });
        return kirim(res, 200, { ok: true, meja: r.meja });
      }
      if (action === 'meja-delete') {
        const r = await data.deleteMeja(tenant.id, String(sumber.id || ''));
        return kirim(res, r.ok ? 200 : 400, { ok: r.ok, error: r.ok ? undefined : 'Meja tidak ditemukan' });
      }
      if (action === 'tenant-save') {
        const fields = {};
        if (sumber.nama) fields.nama = String(sumber.nama).slice(0, 60);
        if (sumber.pin_baru) fields.pin = String(sumber.pin_baru).slice(0, 20);
        if (typeof sumber.payinaja_api_key === 'string' && sumber.payinaja_api_key.trim()) {
          fields.payinaja_api_key = sumber.payinaja_api_key.trim();
        }
        if (!Object.keys(fields).length) return kirim(res, 400, { ok: false, error: 'Tidak ada perubahan' });
        const r = await data.updateTenant(tenant.id, fields);
        if (!r.ok) return kirim(res, 500, { ok: false, error: 'Gagal menyimpan pengaturan' });
        return kirim(res, 200, { ok: true });
      }
      return kirim(res, 400, { ok: false, error: 'Action tidak dikenal' });
    }

    return kirim(res, 405, { ok: false, error: 'Metode tidak didukung' });
  } catch (e) {
    return kirim(res, 500, { ok: false, error: e.message });
  }
};
