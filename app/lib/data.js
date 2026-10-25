'use strict';
/**
 * lib/data.js — SATU-SATUNYA modul yang berbicara ke database.
 * Semua API memakai fungsi di sini; tidak ada query Supabase yang
 * menyebar di file lain. (Pelajaran mahal dari bot toko: akses data
 * yang menyebar membuat perbaikan & migrasi jadi bongkar total.)
 *
 * Semua fungsi tulis MEMVERIFIKASI hasil (return=representation) dan
 * mengembalikan { ok, ... } — pemanggil wajib memeriksa ok.
 */
const crypto = require('crypto');
const sb = require('./supabase');

const enc = encodeURIComponent;

// Awal hari ini (WIB) sebagai ISO UTC — untuk nomor antrian & laporan harian.
function awalHariWIBISO() {
  const now = new Date();
  const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  wib.setHours(0, 0, 0, 0);
  // Selisih WIB (UTC+7) -> ubah kembali ke UTC
  return new Date(wib.getTime() - 7 * 3600 * 1000).toISOString();
}

function buatOrderId() {
  return 'ORD-' + String(Math.floor(100000 + Math.random() * 900000));
}

function buatTokenMeja() {
  return 'mj-' + crypto.randomBytes(8).toString('hex');
}

// ---------------- Tenant ----------------

async function getTenantBySlug(slug) {
  const r = await sb.get(`/tenants?slug=eq.${enc(slug)}&select=*`);
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
  return r.data[0];
}

async function updateTenant(tenantId, fields) {
  const r = await sb.patch(`/tenants?id=eq.${enc(tenantId)}`, fields);
  return { ok: r.ok && Array.isArray(r.data) && r.data.length > 0 };
}

// ---------------- Meja ----------------

async function getMejaByToken(tenantId, token) {
  const r = await sb.get(`/meja?tenant_id=eq.${enc(tenantId)}&token=eq.${enc(token)}&aktif=eq.true&select=*`);
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
  return r.data[0];
}

async function listMeja(tenantId) {
  const r = await sb.get(`/meja?tenant_id=eq.${enc(tenantId)}&select=*&order=nomor.asc`);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

async function addMeja(tenantId, nomor) {
  const r = await sb.post('/meja', { tenant_id: tenantId, nomor: String(nomor), token: buatTokenMeja() });
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) {
    return { ok: false, error: (r.data && r.data.message) || 'Gagal menambah meja (nomor mungkin sudah ada)' };
  }
  return { ok: true, meja: r.data[0] };
}

async function deleteMeja(tenantId, id) {
  const r = await sb.del(`/meja?id=eq.${enc(id)}&tenant_id=eq.${enc(tenantId)}`);
  return { ok: r.ok && Array.isArray(r.data) && r.data.length > 0 };
}

// ---------------- Menu ----------------

async function listMenuPublic(tenantId) {
  const r = await sb.get(`/menu_items?tenant_id=eq.${enc(tenantId)}&tersedia=eq.true&select=*&order=urutan.asc,nama.asc`);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

async function listMenuAll(tenantId) {
  const r = await sb.get(`/menu_items?tenant_id=eq.${enc(tenantId)}&select=*&order=urutan.asc,nama.asc`);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

async function getMenuItem(tenantId, id) {
  const r = await sb.get(`/menu_items?id=eq.${enc(id)}&tenant_id=eq.${enc(tenantId)}&select=*`);
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
  return r.data[0];
}

async function saveMenuItem(tenantId, item) {
  const row = {
    tenant_id: tenantId,
    nama: String(item.nama || '').trim(),
    kategori: String(item.kategori || 'Menu').trim() || 'Menu',
    harga: Math.max(0, parseInt(item.harga, 10) || 0),
    deskripsi: String(item.deskripsi || ''),
    foto_url: item.foto_url ? String(item.foto_url) : null,
    ada_level: !!item.ada_level,
    ekstra: Array.isArray(item.ekstra) ? item.ekstra : [],
    tersedia: item.tersedia !== false,
    urutan: parseInt(item.urutan, 10) || 0,
  };
  if (!row.nama) return { ok: false, error: 'Nama menu wajib diisi' };
  if (item.id) {
    const r = await sb.patch(`/menu_items?id=eq.${enc(item.id)}&tenant_id=eq.${enc(tenantId)}`, row);
    if (!r.ok || !Array.isArray(r.data) || !r.data.length) return { ok: false, error: 'Gagal menyimpan (menu tidak ditemukan)' };
    return { ok: true, item: r.data[0] };
  }
  const r = await sb.post('/menu_items', row);
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return { ok: false, error: (r.data && r.data.message) || 'Gagal menambah menu' };
  return { ok: true, item: r.data[0] };
}

async function deleteMenuItem(tenantId, id) {
  const r = await sb.del(`/menu_items?id=eq.${enc(id)}&tenant_id=eq.${enc(tenantId)}`);
  return { ok: r.ok && Array.isArray(r.data) && r.data.length > 0 };
}

// ---------------- Order ----------------

async function countOrdersToday(tenantId) {
  const r = await sb.get(`/orders_kuliner?tenant_id=eq.${enc(tenantId)}&created_at=gte.${enc(awalHariWIBISO())}&select=id`);
  return r.ok && Array.isArray(r.data) ? r.data.length : 0;
}

// Buat order + item-itemnya. Bila item gagal ditulis, order DIHAPUS
// (kompensasi) — tidak boleh ada order hantu tanpa rincian.
async function createOrderWithItems(orderRow, itemsRows) {
  const r = await sb.post('/orders_kuliner', orderRow);
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) {
    return { ok: false, error: (r.data && r.data.message) || 'Gagal membuat order' };
  }
  const order = r.data[0];
  const ri = await sb.post('/order_items_kuliner', itemsRows);
  if (!ri.ok) {
    await sb.del(`/orders_kuliner?id=eq.${enc(order.id)}`);
    return { ok: false, error: 'Gagal menulis rincian order — order dibatalkan' };
  }
  return { ok: true, order };
}

async function getOrder(orderId) {
  const r = await sb.get(`/orders_kuliner?id=eq.${enc(orderId)}&select=*`);
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
  const order = r.data[0];
  const ri = await sb.get(`/order_items_kuliner?order_id=eq.${enc(orderId)}&select=*`);
  order.items = ri.ok && Array.isArray(ri.data) ? ri.data : [];
  return order;
}

async function patchOrder(orderId, fields) {
  const r = await sb.patch(`/orders_kuliner?id=eq.${enc(orderId)}`, { ...fields, updated_at: new Date().toISOString() });
  return { ok: r.ok && Array.isArray(r.data) && r.data.length > 0 };
}

async function listKitchenOrders(tenantId) {
  const r = await sb.get(
    `/orders_kuliner?tenant_id=eq.${enc(tenantId)}&created_at=gte.${enc(awalHariWIBISO())}` +
    `&status=in.(dibayar,dimasak,siap)&select=*&order=created_at.asc`
  );
  const orders = r.ok && Array.isArray(r.data) ? r.data : [];
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id).join(',');
  const ri = await sb.get(`/order_items_kuliner?order_id=in.(${ids})&select=*`);
  const items = ri.ok && Array.isArray(ri.data) ? ri.data : [];
  for (const o of orders) o.items = items.filter((i) => i.order_id === o.id);
  return orders;
}

async function listOrdersToday(tenantId) {
  const r = await sb.get(
    `/orders_kuliner?tenant_id=eq.${enc(tenantId)}&created_at=gte.${enc(awalHariWIBISO())}&select=id,total,status,created_at&order=created_at.desc`
  );
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

module.exports = {
  awalHariWIBISO,
  buatOrderId,
  getTenantBySlug,
  updateTenant,
  getMejaByToken,
  listMeja,
  addMeja,
  deleteMeja,
  listMenuPublic,
  listMenuAll,
  getMenuItem,
  saveMenuItem,
  deleteMenuItem,
  countOrdersToday,
  createOrderWithItems,
  getOrder,
  patchOrder,
  listKitchenOrders,
  listOrdersToday,
};
