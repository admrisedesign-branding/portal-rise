// /api/portal-diagnostico.js — Vercel Serverless Function (Node 18+, CommonJS)
// Salva / carrega o Raio-X da Presença Digital de cada cliente (tenant).
//   1) valida o access_token da sessão -> e-mail
//   2) acha o cliente (tenant) pelo owner_email
//   3) GET  (sem "save") -> devolve o raio-x salvo desse cliente
//      SAVE (com "save") -> grava (upsert) e devolve o raio-x salvo
//
// POST { access_token }                       -> { diagnostico: {score,dims,respostas,atualizado_em} | null }
// POST { access_token, save:{score,dims,respostas} } -> { ok:true, diagnostico:{...} }
//
// Variáveis de ambiente no Vercel: SUPABASE_SERVICE_ROLE_KEY (secreta), SUPABASE_URL, SUPABASE_ANON_KEY

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
const isMissingTable = (e) => { const m = String(e && e.message || ''); return m.includes('capta_diagnosticos') || m.includes('42P01'); };

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
    const rows = await sb(`capta_tenants?owner_email=eq.${encodeURIComponent(email)}&ativo=is.true&select=id,nome,slug&limit=1`);
    tenant = rows && rows[0];
  } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!tenant) return res.status(403).json({ error: 'Sua conta ainda não está vinculada a um cliente. Fale com a Rise.' });

  // 3a) SAVE (upsert por tenant_id)
  const save = body && body.save;
  if (save && typeof save === 'object') {
    const row = {
      tenant_id: tenant.id,
      score: Number.isFinite(+save.score) ? Math.round(+save.score) : null,
      dims: save.dims || {},
      respostas: save.respostas || [],
      atualizado_em: new Date().toISOString(),
    };
    try {
      const out = await sb('capta_diagnosticos', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(row),
      });
      return res.status(200).json({ ok: true, diagnostico: (out && out[0]) || row });
    } catch (e) {
      if (isMissingTable(e)) return res.status(500).json({ error: 'Tabela capta_diagnosticos ainda não existe no Supabase.' });
      return res.status(500).json({ error: e.message });
    }
  }

  // 3b) LOAD
  try {
    const rows = await sb(`capta_diagnosticos?tenant_id=eq.${tenant.id}&select=score,dims,respostas,atualizado_em&limit=1`);
    return res.status(200).json({ diagnostico: (rows && rows[0]) || null });
  } catch (e) {
    if (isMissingTable(e)) return res.status(200).json({ diagnostico: null }); // ainda sem tabela: trata como "sem raio-x"
    return res.status(500).json({ error: e.message });
  }
};
