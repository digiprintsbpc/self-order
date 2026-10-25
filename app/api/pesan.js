'use strict';
/**
 * api/pesan.js — API publik pelanggan.
 *   GET  ?tenant=<slug>[&meja=<token>]   -> info usaha + meja + menu
 *   GET  ?tenant=<slug>&order=<ORD-xxx> -> status pesanan (cek QRIS bila perlu)
 *   POST { tenant, meja_token, nama, items:[{menu_id, qty, level, ekstra:[nama], catatan}] }
 *        -> buat order + QRIS, harga SELALU dihitung dari database.
 */
const data = require('../lib/data');
const pay = require('../lib/payinaja');
const sb = require('../lib/supabase');

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
  if (!sb.configured()) return kirim(res, 500, { ok: false, error: 'Server belum dikonfigurasi (env Supabase kosong)' });
  try {
    if (req.method === 'GET') {
      const slug = String(req.query.tenant || '');
      const tenant = await data.getTenantBySlug(slug);
      if (!tenant || !tenant.aktif) return kirim(res, 404, { ok: false, error: 'Usaha tidak ditemukan' });

      // --- cek status pesanan ---
      if (req.query.order) {
        const order = await data.getOrder(String(req.query.order));
        if (!order || order.tenant_id !== tenant.id) return kirim(res, 404, { ok: false, error: 'Pesanan tidak ditemukan' });
        if (order.status === 'menunggu_bayar' && order.payment_trx_id && tenant.payinaja_api_key) {
          const cek = await pay.checkTransaction(tenant.payinaja_api_key, order.payment_trx_id);
          if (cek.ok && cek.paid) {
            const upd = await data.patchOrder(order.id, { status: 'dibayar' });
            if (upd.ok) order.status = 'dibayar';
          }
        }
        return kirim(res, 200, {
          ok: true,
          order_id: order.id,
          status: order.status,
          nomor_antrian: order.nomor_antrian,
          nomor_meja: order.nomor_meja,
          total: order.total,
          qr_image_url: order.qr_image_url,
          items: order.items,
        });
      }

      // --- menu publik ---
      let meja = null;
      if (req.query.meja) {
        meja = await data.getMejaByToken(tenant.id, String(req.query.meja));
        if (!meja) return kirim(res, 400, { ok: false, error: 'Kode meja tidak dikenal — scan ulang QR di meja Anda' });
      }
      const menu = await data.listMenuPublic(tenant.id);
      return kirim(res, 200, {
        ok: true,
        tenant: { slug: tenant.slug, nama: tenant.nama },
        meja: meja ? { nomor: meja.nomor } : null,
        menu,
      });
    }

    if (req.method === 'POST') {
      const b = await bacaBody(req);
      const tenant = await data.getTenantBySlug(String(b.tenant || ''));
      if (!tenant || !tenant.aktif) return kirim(res, 404, { ok: false, error: 'Usaha tidak ditemukan' });
      if (!tenant.payinaja_api_key) {
        return kirim(res, 400, { ok: false, error: 'Pembayaran QRIS usaha ini belum diatur pemiliknya' });
      }

      let meja = null;
      if (b.meja_token) {
        meja = await data.getMejaByToken(tenant.id, String(b.meja_token));
        if (!meja) return kirim(res, 400, { ok: false, error: 'Kode meja tidak dikenal — scan ulang QR di meja Anda' });
      }

      const itemsIn = Array.isArray(b.items) ? b.items : [];
      if (!itemsIn.length) return kirim(res, 400, { ok: false, error: 'Keranjang kosong' });

      // Harga dihitung dari database — angka dari pelanggan tidak dipercaya.
      const lines = [];
      let total = 0;
      for (const it of itemsIn.slice(0, 30)) {
        const m = await data.getMenuItem(tenant.id, String(it.menu_id || ''));
        if (!m || !m.tersedia) continue;
        const qty = Math.min(50, Math.max(1, parseInt(it.qty, 10) || 1));
        const ekstraDipilih = [];
        let tambah = 0;
        const namaEkstra = Array.isArray(it.ekstra) ? it.ekstra.map(String) : [];
        for (const e of Array.isArray(m.ekstra) ? m.ekstra : []) {
          if (namaEkstra.includes(e.nama)) {
            ekstraDipilih.push({ nama: e.nama, harga: Number(e.harga) || 0 });
            tambah += Number(e.harga) || 0;
          }
        }
        const hargaSatuan = Number(m.harga) + tambah;
        const level = m.ada_level ? Math.min(5, Math.max(0, parseInt(it.level, 10) || 0)) : null;
        const subtotal = hargaSatuan * qty;
        total += subtotal;
        lines.push({
          menu_id: m.id,
          nama: m.nama,
          qty,
          harga_satuan: hargaSatuan,
          level,
          ekstra: ekstraDipilih,
          catatan: String(it.catatan || '').slice(0, 120),
          subtotal,
        });
      }
      if (!lines.length) return kirim(res, 400, { ok: false, error: 'Tidak ada menu valid di keranjang' });
      if (total <= 0) return kirim(res, 400, { ok: false, error: 'Total tidak valid' });

      const nama = String(b.nama || 'Pelanggan').slice(0, 40);
      const antrian = (await data.countOrdersToday(tenant.id)) + 1;

      let dibuat = null;
      for (let coba = 0; coba < 3 && !dibuat; coba++) {
        const id = data.buatOrderId();
        const r = await data.createOrderWithItems(
          {
            id,
            tenant_id: tenant.id,
            meja_id: meja ? meja.id : null,
            nomor_meja: meja ? meja.nomor : null,
            nomor_antrian: antrian,
            nama_pelanggan: nama,
            total,
            status: 'menunggu_bayar',
          },
          lines.map((l) => ({ ...l, order_id: id }))
        );
        if (r.ok) dibuat = r.order;
        else if (!/duplicate|unique|pkey/i.test(r.error || '')) return kirim(res, 500, { ok: false, error: r.error });
      }
      if (!dibuat) return kirim(res, 500, { ok: false, error: 'Gagal membuat pesanan, coba lagi' });

      const qr = await pay.createQRIS(tenant.payinaja_api_key, total, dibuat.id, nama);
      if (!qr.ok) {
        await data.patchOrder(dibuat.id, { status: 'batal' });
        return kirim(res, 502, { ok: false, error: 'QRIS gagal dibuat: ' + qr.error });
      }
      let simpan = await data.patchOrder(dibuat.id, { payment_trx_id: qr.trx_id, qr_image_url: qr.qr_image_url });
      if (!simpan.ok) simpan = await data.patchOrder(dibuat.id, { payment_trx_id: qr.trx_id, qr_image_url: qr.qr_image_url });
      if (!simpan.ok) {
        return kirim(res, 500, { ok: false, error: 'Pesanan dibuat tetapi data pembayaran gagal disimpan — hubungi pemilik usaha', order_id: dibuat.id });
      }

      return kirim(res, 200, {
        ok: true,
        order_id: dibuat.id,
        nomor_antrian: antrian,
        nomor_meja: meja ? meja.nomor : null,
        total,
        qr_image_url: qr.qr_image_url,
        status: 'menunggu_bayar',
      });
    }

    return kirim(res, 405, { ok: false, error: 'Metode tidak didukung' });
  } catch (e) {
    return kirim(res, 500, { ok: false, error: e.message });
  }
};
