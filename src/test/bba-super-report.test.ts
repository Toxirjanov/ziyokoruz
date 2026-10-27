import { describe, expect, it } from 'vitest';
import { superReportDetails } from '../lib/bba-super-report';
describe('Super admin detailed report', () => {
  const row = { branchId:'primary', branch:'Ziyokor', student:'one', name:'One', subject:'Matematika', at:Date.UTC(2026,9,1), test:40, written:10, total:50, percentage:50/65*100 };
  it('uses collected-score percentage and excludes pending writing from averages', () => {
    const report = superReportDetails([], [], [row, {...row, student:'two', written:null, total:null, percentage:null}], '2026-10');
    expect(report.average).toBe(50/65*100);
    expect(report.results).toHaveLength(2);
  });
  it('deduplicates started attempts in trends and applies Tashkent month boundaries', () => {
    const entry = {branch:'primary', student:'one', subject:'Matematika', at:Date.UTC(2026,8,30,20)};
    const report = superReportDetails([entry,entry], [], [row], '2026-10');
    expect(report.trend.at(-1)?.participants).toBe(1);
    expect(report.trend[0].month).toBe('2025-11');
    expect(report.previous.participants).toBe(0);
  });
});