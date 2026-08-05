// /api/portal-relatorios.js — Vercel Serverless Function (Node 18+, CommonJS)
// Portal do Cliente Rise. O cliente loga (Supabase Auth) e esta função:
//   1) valida o access_token da sessão -> descobre o e-mail
//   2) acha o cliente (tenant) pelo owner_email
//   3) devolve os relatórios publicados desse cliente
// Nada de token na URL: o acesso é por login (e-mail + senha).
//
// POST { access_token }  ->  { tenant:{nome,plano,slug}, relatorios:[{mes,dados,atualizado_em}] }
//
// Variáveis de ambiente no Vercel (deste projeto do portal):
//   SUPABASE_SERVICE_ROLE_KEY  (secreta) — copie do projeto do Capta
//   SUPABASE_URL               (opcional, default abaixo)
//   SUPABASE_ANON_KEY          (opcional, default abaixo — chave pública)

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wpoeigoledhzyvomudgf.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY     = process.env.SUPABASE_ANON_KEY || 'sb_publishable_S4eWNjOtaiXTo5sr9Hek0A_42NzE4jf';

async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY no Vercel.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const token = (body && body.access_token) || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(400).json({ error: 'Sem sessão. Faça login de novo.' });

  // 1) valida a sessão -> e-mail
  let email = '';
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } });
    if (!r.ok) return res.status(401).json({ error: 'Sessão expirada. Entre de novo.' });
    const u = await r.json();
    email = (u && u.email ? u.email : '').toLowerCase().trim();
  } catch (e) { return res.status(401).json({ error: 'Sessão inválida.' }); }
  if (!email) return res.status(401).json({ error: 'Conta sem e-mail.' });

  // 2) acha o cliente pelo owner_email
  let tenant;
  try {
    const rows = await sb(`capta_tenants?owner_email=eq.${encodeURIComponent(email)}&ativo=is.true&select=id,nome,plano,slug&limit=1`);
    tenant = rows && rows[0];
  } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!tenant) return res.status(403).json({ error: 'Sua conta ainda não está vinculada a um cliente. Fale com a Rise.' });

  // 3) relatórios publicados
  let relatorios = [];
  try {
    relatorios = await sb(`capta_relatorios?tenant_id=eq.${tenant.id}&publicado=is.true&select=mes,dados,atualizado_em&order=mes.desc`);
  } catch (e) {
    const msg = String(e.message || '');
    if (!(msg.includes('capta_relatorios') || msg.includes('42P01'))) return res.status(500).json({ error: e.message });
    relatorios = []; // tabela ainda não existe: devolve vazio
  }

  return res.status(200).json({
    tenant: { nome: tenant.nome, plano: tenant.plano, slug: tenant.slug },
    relatorios: relatorios || [],
  });
};
