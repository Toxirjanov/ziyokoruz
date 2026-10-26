import { describe, it, expect } from 'vitest';
import { monthlyParticipation, roleCanAct } from '../lib/bba-branches';
describe('Super admin and branch rules', () => {
  it('super admin creates admins but cannot add students, questions, variants or alter results', () => {
    expect(roleCanAct('super_admin', 'createBranch')).toBe(true);
    for (const action of ['addst', 'save', 'reset', 'clear', 'result', 'del', 'setadm']) expect(roleCanAct('super_admin', action)).toBe(false);
  });
  it('branch admins keep existing admin actions', () => {
    for (const action of ['addst', 'save', 'reset', 'clear']) expect(roleCanAct('branch_admin', action)).toBe(true);
  });
  it('counts monthly participants by branch and subject without mixing students', () => {
    const rows = [
      { branch: 'Ziyokor', student: 'one', subject: 'Matematika', at: Date.UTC(2026, 9, 1) },
      { branch: 'Ziyokor', student: 'one', subject: 'Matematika', at: Date.UTC(2026, 9, 2) },
      { branch: 'Filial 2', student: 'one', subject: 'Huquq', at: Date.UTC(2026, 9, 3) },
      { branch: 'Ziyokor', student: 'two', subject: 'Matematika', at: Date.UTC(2026, 8, 1) },
    ];
    expect(monthlyParticipation(rows, '2026-10')).toEqual({ participants: 2, groups: [
      { branch: 'Ziyokor', subject: 'Matematika', participants: 1 },
      { branch: 'Filial 2', subject: 'Huquq', participants: 1 },
    ] });
  });
  it('uses Tashkent month boundaries', () => {
    expect(monthlyParticipation([{ branch: 'Ziyokor', student: 'one', subject: 'Matematika', at: Date.UTC(2026, 8, 30, 20) }], '2026-10').participants).toBe(1);
  });
});