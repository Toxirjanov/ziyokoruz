const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
export async function hashPassword(password: string, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return `${salt}:${hex(new Uint8Array(bits))}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt] = stored.split(':');
  if (!salt) return false;
  const actual = await hashPassword(password, salt);
  let difference = actual.length ^ stored.length;
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ (stored.charCodeAt(i) || 0);
  return difference === 0;
}