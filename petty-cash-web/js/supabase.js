import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://ilapjwjswpswdxzfmmqn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_D_sigwHyTwWW8J6Rhllg9w_SX75bazV';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Auth ──────────────────────────────────────────────────────
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await sb.auth.signOut();
}

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function getProfile(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('*, companies(name,short_name)')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

// ── Petty Cash ────────────────────────────────────────────────
export async function listPettyCash(companyId, role, userId) {
  let q = sb.from('petty_cash').select(`
    *, companies(name), profiles!created_by(full_name)
  `).order('created_at', { ascending: false });

  if (role === 'staff') q = q.eq('created_by', userId);
  else if (companyId) q = q.eq('company_id', companyId);

  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function getPettyCash(id) {
  const { data, error } = await sb.from('petty_cash').select(`
    *, companies(name), profiles!created_by(full_name),
    expenses(*), trips(*)
  `).eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function savePettyCash(record) {
  if (record.id) {
    const { id, ...rest } = record;
    const { data, error } = await sb.from('petty_cash').update(rest).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await sb.from('petty_cash').insert(record).select().single();
  if (error) throw error;
  return data;
}

export async function deletePettyCash(id) {
  const { error } = await sb.from('petty_cash').delete().eq('id', id);
  if (error) throw error;
}

export async function submitForApproval(id) {
  const { error } = await sb.from('petty_cash').update({ status: 'pending' }).eq('id', id);
  if (error) throw error;
}

export async function approveRecord(id, userId, approved, notes = '') {
  const { error } = await sb.from('petty_cash').update({
    status: approved ? 'approved' : 'rejected',
    approved_by: userId,
    approved_at: new Date().toISOString(),
    notes
  }).eq('id', id);
  if (error) throw error;
}

// ── Expenses ──────────────────────────────────────────────────
export async function saveExpenses(pettyCashId, items) {
  await sb.from('expenses').delete().eq('petty_cash_id', pettyCashId);
  if (!items.length) return;
  const { error } = await sb.from('expenses').insert(
    items.map(i => ({ ...i, petty_cash_id: pettyCashId }))
  );
  if (error) throw error;
}

// ── Trips ─────────────────────────────────────────────────────
export async function saveTrips(pettyCashId, items) {
  await sb.from('trips').delete().eq('petty_cash_id', pettyCashId);
  if (!items.length) return;
  const { error } = await sb.from('trips').insert(
    items.map(i => ({ ...i, petty_cash_id: pettyCashId }))
  );
  if (error) throw error;
}

// ── Photo upload ──────────────────────────────────────────────
export async function uploadPhoto(file, path) {
  const { data, error } = await sb.storage.from('receipts').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data: urlData } = sb.storage.from('receipts').getPublicUrl(data.path);
  return urlData.publicUrl;
}

// ── Documents (approval workflow) ────────────────────────────
export async function listDocuments(companyId, role, userId) {
  let q = sb.from('documents').select(`
    *, companies(name), profiles!created_by(full_name)
  `).order('created_at', { ascending: false });

  if (role === 'staff') q = q.eq('created_by', userId);
  else if (companyId && role !== 'owner') q = q.eq('company_id', companyId);

  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function saveDocument(doc) {
  if (doc.id) {
    const { id, ...rest } = doc;
    const { data, error } = await sb.from('documents').update(rest).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await sb.from('documents').insert(doc).select().single();
  if (error) throw error;
  return data;
}

export async function approveDocument(id, userId, approved, notes = '') {
  const { error } = await sb.from('documents').update({
    status: approved ? 'approved' : 'rejected',
    approved_by: userId,
    approved_at: new Date().toISOString(),
    notes
  }).eq('id', id);
  if (error) throw error;
}

// ── Companies ─────────────────────────────────────────────────
export async function listCompanies() {
  const { data, error } = await sb.from('companies').select('*').order('name');
  if (error) throw error;
  return data;
}

// ── Admin: list users ─────────────────────────────────────────
export async function listProfiles() {
  const { data, error } = await sb.from('profiles')
    .select('*, companies(name)').order('full_name');
  if (error) throw error;
  return data;
}

export { sb };
