import { createFileRoute } from "@tanstack/react-router";
import { examCompleted, uniqueStudentLogin } from "@/lib/bba-access";
import { snapshotResult, evaluateResult, validateWrittenScore } from '../../../../public/bba-grading.js';

type St = { login: string; pass: string; name: string; sid?: number; [k: string]: unknown };
type R = { id?: number; [k: string]: unknown };
type DBT = { st: St[]; qs: unknown[]; res: R[]; dur: number; [k: string]: unknown };
type P = { key: string; start: number; end: number; ans: Record<string, unknown>; r?: R };

const DEF: DBT = { st: [{ login: "demo", pass: "demo123", name: "Namuna O'quvchi", sid: 1 }], qs: [], res: [], dur: 90 };
const PB = 100000; // progress rows: bba_state.id = PB + student sid
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type" };
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
        const b = (await request.json()) as {
          a: string; nu?: string; np?: string; u?: string; p?: string; db?: DBT; r?: R; key?: string; ans?: Record<string, unknown>; name?: string; login?: string;
        };
        const now = Date.now();
        const { data: row } = await supabaseAdmin.from("bba_state").select("data").eq("id", 1).maybeSingle();
        const db = (row?.data as DBT) ?? structuredClone(DEF);
        db.st = db.st || [];
        db.res = db.res || [];
        let dirty = false;
        db.st.forEach((s) => {
          if (!s.sid) { s.sid = Math.max(0, ...db.st.map((x) => x.sid || 0)) + 1; dirty = true; }
        });
        const put = (d: DBT) => supabaseAdmin.from("bba_state").upsert({ id: 1, data: d as never, updated_at: new Date().toISOString() });
        const getP = async (sid: number) => {
          const { data } = await supabaseAdmin.from("bba_state").select("data").eq("id", PB + sid).maybeSingle();
          return (data?.data as P) ?? null;
        };
        const putP = (sid: number, d: P) => supabaseAdmin.from("bba_state").upsert({ id: PB + sid, data: d as never, updated_at: new Date().toISOString() });
        if (dirty) await put(db);
        const ad = (db["adm"] as { u: string; p: string }) || { u: "admin", p: "admin123" };
        const admin = !!b.u && b.u === ad.u && b.p === ad.p;
        const stu = admin ? undefined : db.st.find((x) => x.login === b.u && x.pass === b.p);
        const pub = (s: St) => ({ id: s.login, email: s.login, name: s.name });

        if (b.a === "login") {
          if (admin) {
            // fold in any finished results stored on progress rows (no lost results on concurrent finishes)
            const { data: rows } = await supabaseAdmin.from("bba_state").select("data").gte("id", PB);
            const ids = new Set(db.res.map((r) => r.id));
            let add = false;
            (rows ?? []).forEach((x) => { const r = (x.data as P)?.r; if (r && !ids.has(r.id)) { db.res.push(r); add = true; } });
            if (add) await put(db);
            const { adm: _a, ...safe } = db; return j({ admin: true, db: safe });
          }
          if (!stu) return j({ error: 1 }, 401);
          if (!stu.sid) return j({ error: 1 }, 409);
          const pr = await getP(stu.sid);
          if (examCompleted(stu.login, db.res, pr)) return j({ error: 1, completed: true }, 403);
          return j({ s: pub(stu), qs: db.qs, dur: db.dur, act: db["act"], vars: db["vars"], prog: pr && !pr.r ? pr : null, now });
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
        if (b.a === "users") return j({ st: db.st });
        if (b.a === "addst") {
          const name = String(b.name || "").trim().replace(/\s+/g, " ");
          if (name.length < 3 || name.length > 100) return j({ error: 1 }, 400);
          const w = name.split(" "), base = slug(w[1] || w[0] || "");
          const login = uniqueStudentLogin(base, db.st);
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
          if (s.sid) await supabaseAdmin.from("bba_state").delete().eq("id", PB + s.sid);
          await put(db);
          return j({ ok: 1 });
        }
        if (b.a === "setadm") {
          const nu = String(b.nu || "").trim(), np = String(b.np || "");
          if (nu.length < 3 || np.length < 6 || db.st.some((x) => x.login === nu)) return j({ error: 1 }, 400);
          db["adm"] = { u: nu, p: np };
          await put(db);
          return j({ ok: 1 });
        }
        if (b.a === "reset") {
          const s = db.st.find((x) => x.login === b.login);
          if (!s) return j({ error: 1 }, 404);
          db.res = db.res.filter((r) => r["uid"] !== s.login);
          if (s.sid) await supabaseAdmin.from("bba_state").delete().eq("id", PB + s.sid);
          await put(db);
          return j({ ok: 1 });
        }
        if (b.a === "clear") {
          // clears results + exam history only; student logins/passwords stay
          db.res = [];
          await supabaseAdmin.from("bba_state").delete().gte("id", PB);
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
      },
    },
  },
});
