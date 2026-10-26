import { createFileRoute } from "@tanstack/react-router";
import { monthlyParticipation, roleCanAct, type Participation } from "@/lib/bba-branches";
import { examCompleted, uniqueStudentLogin } from "@/lib/bba-access";
import { snapshotResult, evaluateResult, validateWrittenScore } from '../../../../public/bba-grading.js';

type St = { login: string; pass: string; name: string; sid?: number; [k: string]: unknown };
type R = { id?: number; [k: string]: unknown };
type DBT = { st: St[]; qs: unknown[]; res: R[]; dur: number; [k: string]: unknown };
type P = { key: string; start: number; end: number; ans: Record<string, unknown>; r?: R };

const DEF: DBT = { st: [{ login: "demo", pass: "demo123", name: "Namuna O'quvchi", sid: 1 }], qs: [], res: [], dur: 90 };
const PB = 100000; // progress rows: bba_state.id = PB + student sid
const CORS = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type" };
const j = (b: unknown, s = 200) => Response.json(b, { status: s, headers: CORS });
const rnd = (n: number, abc: string) => {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return [...a].map((x) => abc[x % abc.length]).join("");
};
const slug = (s: string) =>
  (s.split(/\s+/)[0] || "")
    .toLowerCase()
    .replace(/[‘’`ʻʼ']/g, "")
    .replace(/[^a-z]/g, "")
    .slice(0, 16) || "talaba";

export const Route = createFileRoute("/api/public/bba")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
        const b = (await request.json()) as {
          a: string; nu?: string; np?: string; u?: string; p?: string; db?: DBT; r?: R; key?: string; ans?: Record<string, unknown>; name?: string; login?: string; branch?: string; month?: string;
        };
        const now = Date.now();
        const { data: row } = await supabaseAdmin.from("bba_state").select("data").eq("id", 1).maybeSingle();
        const legacy = (row?.data as DBT) ?? structuredClone(DEF);
        const { hashPassword, verifyPassword } = await import('@/lib/bba-password.server');
        const { data: account } = await supabaseAdmin.from('bba_accounts').select('id,password_hash').eq('login', String(b.u || '').toLowerCase()).maybeSingle();
        const validAccount = account && await verifyPassword(String(b.p || ''), account.password_hash);
        const { data: role } = validAccount ? await supabaseAdmin.from('bba_account_roles').select('role,branch_id').eq('account_id', account.id).maybeSingle() : { data: null };
        if (role?.role === 'super_admin') {
          if (!roleCanAct(role.role, b.a)) return j({ error: 1 }, 403);
          if (b.a === 'createBranch') {
            const login = String(b.nu || '').trim().toLowerCase(), pass = String(b.np || ''), name = String(b.name || '').trim();
            if (!/^[a-z0-9_.@-]{3,80}$/.test(login) || pass.length < 8 || pass.length > 128 || name.length < 2 || name.length > 100 || login === String((legacy['adm'] as {u?:string})?.u || 'admin').toLowerCase() || legacy.st.some(x => x.login.toLowerCase() === login)) return j({ error: 1, message: 'Filial nomi, yangi login va kamida 8 belgili parol kiriting.' }, 400);
            const { error } = await supabaseAdmin.rpc('bba_create_admin', { _login: login, _hash: await hashPassword(pass), _name: name });
            return error ? j({ error: 1, message: 'Bu login band yoki filialni saqlab bo‘lmadi.' }, 409) : j({ ok: 1 });
          }
          const month = /^\d{4}-\d{2}$/.test(b.month || '') ? String(b.month) : new Date(now + 5*3600000).toISOString().slice(0,7);
          const { data: branches } = await supabaseAdmin.from('bba_branches').select('id,name,created_at');
          const { data: states } = await supabaseAdmin.from('bba_branch_state').select('branch_id,data');
          const { data: progress } = await supabaseAdmin.from('bba_branch_progress').select('branch_id,sid,data');
          const { data: oldProgress } = await supabaseAdmin.from('bba_state').select('id,data').gte('id', PB);
          const entries: Participation[] = [];
          const collect = (branch: string, data: DBT, prs: {sid:number;data:unknown}[]) => {
            for (const r of data.res || []) entries.push({ branch, student: String(r['uid'] || r.id), subject: String(r['vf'] || String(r['fan'] || '').split(' — ')[0]), at: Number(r.id) });
            for (const item of prs) {
              const pr = item.data as P;
              const student = data.st.find(x=>x.sid===item.sid);
              if (!student || !pr.start) continue;
              let subject = 'Fan belgilanmagan';
              try { if (pr.key[0]==='v') subject=String(JSON.parse(pr.key.slice(1))[0]); } catch { /* invalid legacy key */ }
              entries.push({branch,student:student.login,subject,at:pr.start});
            }
          };
          collect('Ziyokor',legacy,(oldProgress || []).map(x=>({sid:x.id-PB,data:x.data})));
          for (const branch of branches || []) {
            const state = states?.find(x=>x.branch_id===branch.id)?.data as DBT | undefined;
            if (state) collect(branch.id,state,(progress || []).filter(x=>x.branch_id===branch.id));
          }
          const report = monthlyParticipation(entries,month);
          const { data: accounts } = await supabaseAdmin.from('bba_accounts').select('id,login,created_at');
          const { data: roles } = await supabaseAdmin.from('bba_account_roles').select('account_id,branch_id');
          return j({ superAdmin: true, month, ...report, groups:report.groups.map(g=>({...g,branch:g.branch==='Ziyokor'?'Ziyokor':branches?.find(x=>x.id===g.branch)?.name || g.branch})), branches:[{id:'primary',name:'Ziyokor',login:String((legacy['adm'] as {u?:string})?.u || 'admin')},...(branches || []).map(x=>({...x,login:accounts?.find(a=>a.id===roles?.find(r=>r.branch_id===x.id)?.account_id)?.login || ''}))] });
        }
        let branchId = role?.role === 'branch_admin' ? role.branch_id : null;
        const ad = (legacy['adm'] as { u: string; p: string }) || { u: 'admin', p: 'admin123' };
        const primaryAdmin = !account && !!b.u && b.u === ad.u && b.p === ad.p;
        let db = legacy;
        if (!primaryAdmin && !branchId && !account) {
          const { data: states } = await supabaseAdmin.from('bba_branch_state').select('branch_id,data');
          const matches = (states || []).filter(x => (x.data as DBT).st?.some(st=>st.login===b.u && st.pass===b.p));
          if (b.branch && b.branch !== 'primary') branchId = matches.find(x=>x.branch_id===b.branch)?.branch_id || null;
          else if (matches.length===1 && !legacy.st.some(st=>st.login===b.u && st.pass===b.p)) branchId=matches[0]?.branch_id || null;
        }
        if (branchId) {
          const { data: state, error } = await supabaseAdmin.from('bba_branch_state').select('data').eq('branch_id',branchId).single();
          if (error || !state) return j({error:1},503);
          db = state.data as DBT;
        }
        if (b.branch && b.branch !== (branchId || 'primary')) return j({error:1},403);
        db.st = db.st || [];
        db.res = db.res || [];
        let dirty = false;
        db.st.forEach((s) => {
          if (!s.sid) { s.sid = Math.max(0, ...db.st.map((x) => x.sid || 0)) + 1; dirty = true; }
        });
        const put = (d: DBT) => branchId ? supabaseAdmin.from('bba_branch_state').upsert({branch_id:branchId,data:d as never,updated_at:new Date().toISOString()}) : supabaseAdmin.from("bba_state").upsert({ id: 1, data: d as never, updated_at: new Date().toISOString() });
        const getP = async (sid: number) => {
          const { data } = branchId ? await supabaseAdmin.from("bba_branch_progress").select("data").eq("branch_id",branchId).eq("sid",sid).maybeSingle() : await supabaseAdmin.from("bba_state").select("data").eq("id", PB + sid).maybeSingle();
          return (data?.data as P) ?? null;
        };
        const putP = (sid: number, d: P) => branchId ? supabaseAdmin.from("bba_branch_progress").upsert({branch_id:branchId,sid,data:d as never}) : supabaseAdmin.from("bba_state").upsert({ id: PB + sid, data: d as never, updated_at: new Date().toISOString() });
        if (dirty) await put(db);
        const deleteP = (sid: number) => branchId ? supabaseAdmin.from('bba_branch_progress').delete().eq('branch_id',branchId).eq('sid',sid) : supabaseAdmin.from('bba_state').delete().eq('id',PB+sid);
        const admin = primaryAdmin || role?.role === 'branch_admin';
        const stu = admin ? undefined : db.st.find((x) => x.login === b.u && x.pass === b.p);
        const pub = (s: St) => ({ id: s.login, email: s.login, name: s.name });

        if (b.a === "login") {
          if (admin) {
            // fold in any finished results stored on progress rows (no lost results on concurrent finishes)
            const { data: rows } = branchId ? await supabaseAdmin.from("bba_branch_progress").select("data").eq("branch_id",branchId) : await supabaseAdmin.from("bba_state").select("data").gte("id", PB);
            const ids = new Set(db.res.map((r) => r.id));
            let add = false;
            (rows ?? []).forEach((x) => { const r = (x.data as P)?.r; if (r && !ids.has(r.id)) { db.res.push(r); add = true; } });
            if (add) await put(db);
            const { adm: _a, ...safe } = db; const { count } = await supabaseAdmin.from("bba_account_roles").select("account_id",{count:"exact",head:true}).eq("role","super_admin");
            return j({ admin: true, db: safe, branch:branchId || "primary", canSetupSuper:primaryAdmin && count===0 });
          }
          if (!stu) return j({ error: 1 }, 401);
          if (!stu.sid) return j({ error: 1 }, 409);
          const pr = await getP(stu.sid);
          if (examCompleted(stu.login, db.res, pr)) return j({ error: 1, completed: true }, 403);
          return j({ branch:branchId || "primary", s: pub(stu), qs: db.qs, dur: db.dur, act: db["act"], vars: db["vars"], prog: pr && !pr.r ? pr : null, now });
        }
        if (b.a === "begin") {
          if (!stu || !b.key) return j({ error: 1 }, 403);
          if (!stu.sid) return j({ error: 1 }, 409);
          const pr = await getP(stu.sid);
          if (examCompleted(stu.login, db.res, pr)) return j({ error: 1, completed: true }, 403);
          if (pr && !pr.r) return j({ prog: pr, now });
          try {
            const k = String(b.key);
            if (k[0] === "v") {
              const [f, n] = JSON.parse(k.slice(1)) as [string, string];
              const v = (((db["vars"] as { fan: string; name: string; open?: number }[] | undefined) || [])).find((x) => x.fan === f && x.name === n);
              if (v?.open && now < v.open) return j({ error: 1, notyet: 1, open: v.open, now }, 403);
            }
          } catch { /* noto‘g‘ri kalit — davom etamiz */ }
          const np: P = { key: String(b.key).slice(0, 300), start: now, end: now + (Number(db.dur) || 90) * 60000, ans: {} };
          await putP(stu.sid, np);
          return j({ prog: np, now });
        }
        if (b.a === "ans") {
          if (!stu || !b.ans || typeof b.ans !== "object") return j({ error: 1 }, 403);
          if (JSON.stringify(b.ans).length > 200000) return j({ error: 1 }, 413);
          if (!stu.sid) return j({ error: 1 }, 409);
          const pr = await getP(stu.sid);
          if (!pr || pr.r) return j({ error: 1 }, 409);
          if (now > pr.end + 30000) return j({ late: 1, now });
          pr.ans = b.ans;
          await putP(stu.sid, pr);
          return j({ ok: 1, now });
        }
        if (b.a === "result") {
          if (!stu || !b.r) return j({ error: 1 }, 403);
          if (!stu.sid) return j({ error: 1 }, 409);
          const pr = await getP(stu.sid);
          if (examCompleted(stu.login, db.res, pr)) return j({ ok: 1 });
          if (!pr) return j({ error: 1 }, 409);
           const r = snapshotResult({ ...b.r, uid: stu.login, email: stu.login, name: stu.name }, db);
           if (r.grading.gradingStatus === 'invalid') return j({ error: 1, message: r.grading.error }, 400);
          const persisted = await putP(stu.sid, { ...pr, r });
          if (persisted.error) return j({ error: 1 }, 500);
          db.res.push(r);
          await put(db);
          return j({ ok: 1 });
        }
        if (!admin) return j({ error: 1 }, 403);
        if (b.a === 'setupSuper') {
          if (!primaryAdmin) return j({error:1},403);
          const login=String(b.nu || '').trim().toLowerCase(), pass=String(b.np || '');
          if (!/^[a-z0-9_.@-]{3,80}$/.test(login) || pass.length<8 || pass.length>128 || login===ad.u.toLowerCase() || db.st.some(x=>x.login.toLowerCase()===login)) return j({error:1,message:'Boshqa login va kamida 8 belgili parol kiriting.'},400);
          const {error}=await supabaseAdmin.rpc('bba_create_admin',{_login:login,_hash:await hashPassword(pass),_name:'',_super:true});
          return error ? j({error:1,message:'Super admin allaqachon mavjud yoki login band.'},409) : j({ok:1});
        }
        if (b.a === "users") return j({ st: db.st });
        if (b.a === "addst") {
          const name = String(b.name || "").trim().replace(/\s+/g, " ");
          if (name.length < 3 || name.length > 100) return j({ error: 1 }, 400);
          const w = name.split(" "), base = slug(w[1] || w[0] || "");
          const login = uniqueStudentLogin(branchId ? base+branchId.slice(0,8) : base, db.st);
          const s: St = { name, login, pass: base + rnd(3, "0123456789"), sid: Math.max(0, ...db.st.map((x) => x.sid || 0)) + 1 };
          db.st.push(s);
          const saved = await put(db);
          if (saved.error) return j({ error: 1 }, 503);
          return j({ st: s });
        }
        if (b.a === "del") {
          const s = db.st.find((x) => x.login === b.login);
          if (!s) return j({ error: 1 }, 404);
          db.st = db.st.filter((x) => x !== s);
          db.res = db.res.filter((r) => r["uid"] !== s.login);
          if (s.sid) await deleteP(s.sid);
          await put(db);
          return j({ ok: 1 });
        }
        if (b.a === "setadm") {
          const nu = String(b.nu || "").trim(), np = String(b.np || "");
          if (nu.length < 3 || np.length < 6 || db.st.some((x) => x.login === nu)) return j({ error: 1 }, 400);
          if (branchId && account) {
            const {error}=await supabaseAdmin.from('bba_accounts').update({login:nu.toLowerCase(),password_hash:await hashPassword(np)}).eq('id',account.id);
            return error ? j({error:1},409) : j({ok:1});
          }
          db["adm"] = { u: nu, p: np };
          await put(db);
          return j({ ok: 1 });
        }
        if (b.a === "reset") {
          const s = db.st.find((x) => x.login === b.login);
          if (!s) return j({ error: 1 }, 404);
          db.res = db.res.filter((r) => r["uid"] !== s.login);
          if (s.sid) await deleteP(s.sid);
          await put(db);
          return j({ ok: 1 });
        }
        if (b.a === "clear") {
          // clears results + exam history only; student logins/passwords stay
          db.res = [];
          await (branchId ? supabaseAdmin.from("bba_branch_progress").delete().eq("branch_id",branchId) : supabaseAdmin.from("bba_state").delete().gte("id", PB));
          await put(db);
          return j({ ok: 1 });
        }
        if (b.a === "save") {
          if (!b.db) return j({ error: 1 }, 400);
          const d = b.db;
          d["adm"] = db["adm"]; d.st = db.st; // accounts are managed server-side only
          const ids = new Set((d.res || []).map((r) => r.id));
          d.res = [...(d.res || []), ...db.res.filter((r) => !ids.has(r.id))];
           if ((d['vars'] as { tot?: unknown }[] || []).some(v => !Number.isFinite(Number(v.tot)) || Number(v.tot) <= 0)) return j({ error: 1, message: 'Maksimal ball musbat son bo‘lsin.' }, 400);
           const original = new Map(db.res.map(r => [r.id, r]));
           // Retain the persisted attempt maximum unless its own grading was explicitly updated.
           d.res = d.res.map(r => {
             const previous = original.get(r.id);
             const preserved = previous && !r['gradingVersion'] ? snapshotResult(previous, db) : null;
             const source = preserved ? { ...r, mx: preserved.mx, weights: preserved.weights, gradingVersion: 1 } : r;
             return snapshotResult(source, d);
           });
           try { d.res.forEach(r => { if (Number(r['wn']) > 0) validateWrittenScore(r['ws'], r['wm'] ?? r['wn']); }); }
           catch { return j({ error: 1, message: 'Yozma ball maksimal yozma balldan oshmasin.' }, 400); }
           const invalid = d.res.find(r => evaluateResult(r, d).gradingStatus === 'invalid');
           if (invalid) return j({ error: 1, message: evaluateResult(invalid, d).error }, 400);
          await put(d);
          return j({ ok: 1 });
        }
        return j({ error: 1 }, 400);
        } catch { return j({error:1,message:"Ma’lumotlarni yuklab bo‘lmadi. Qayta urinib ko‘ring."},503); }
      },
    },
  },
});
