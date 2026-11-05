import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const COOKIE = 'inv_session';
const key = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET não configurado');
  return new TextEncoder().encode(s);
};

export async function criarSessao(userId: string) {
  const token = await new SignJWT({ uid: userId }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('12h').sign(key());
  cookies().set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 60 * 60 * 12 });
}
export function encerrarSessao() { cookies().delete(COOKIE); }
export async function lerSessao(): Promise<string | null> {
  const t = cookies().get(COOKIE)?.value;
  if (!t) return null;
  try { const { payload } = await jwtVerify(t, key()); return String(payload.uid); } catch { return null; }
}
