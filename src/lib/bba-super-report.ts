import { monthlyParticipation, type Participation } from './bba-branches';
export type ReportStudent = { branchId: string; branch: string; login: string; name: string };
export type ReportResult = { branchId: string; branch: string; student: string; name: string; subject: string; at: number; test: number; written: number | null; total: number | null; percentage: number | null };
export function superReportDetails(entries: Participation[], students: ReportStudent[], results: ReportResult[], month: string) {
  const inMonth = (at: number, m: string) => Number.isFinite(at) && new Date(at + 5 * 3600000).toISOString().slice(0, 7) === m;
  const selected = results.filter(r => inMonth(r.at, month));
  const average = (rows: ReportResult[]) => { const final = rows.filter(r => r.percentage !== null); return final.length ? final.reduce((n, r) => n + Number(r.percentage), 0) / final.length : null; };
  const year = Number(month.slice(0, 4)), mon = Number(month.slice(5, 7));
  const trend = Array.from({ length: 12 }, (_, i) => {
    const m = new Date(Date.UTC(year, mon - 12 + i, 1)).toISOString().slice(0, 7);
    return { month: m, ...monthlyParticipation(entries, m), average: average(results.filter(r => inMonth(r.at, m))) };
  });
  const previousMonth = new Date(Date.UTC(year, mon - 2, 1)).toISOString().slice(0, 7);
  return { students, results: selected, average: average(selected), trend, previous: monthlyParticipation(entries, previousMonth), previousResults: results.filter(r => inMonth(r.at, previousMonth)) };
}