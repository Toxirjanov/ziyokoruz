export type Participation = { branch: string; student: string; subject: string; at: number };
export const superActions = new Set(['login', 'superReport', 'createBranch']);
export function roleCanAct(role: string, action: string) {
  return role === 'super_admin' ? superActions.has(action) : role === 'branch_admin';
}
export function monthlyParticipation(rows: Participation[], month: string) {
  const unique = new Map<string, Participation>();
  for (const row of rows) {
    const date = new Date(row.at + 5 * 3600000);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 7) !== month) continue;
    unique.set(JSON.stringify([row.branch, row.student, row.subject]), row);
  }
  const filtered = [...unique.values()];
  const groups = new Map<string, { branch: string; subject: string; participants: number }>();
  for (const row of filtered) {
    const key = JSON.stringify([row.branch, row.subject]);
    const group = groups.get(key) ?? { branch: row.branch, subject: row.subject, participants: 0 };
    group.participants++;
    groups.set(key, group);
  }
  return { participants: new Set(filtered.map(r => JSON.stringify([r.branch, r.student]))).size, groups: [...groups.values()] };
}