import { z } from 'zod'

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'must be a valid email address' }).max(254))

/**
 * 8–72 characters: 72 bytes is where bcrypt (Supabase Auth's hash) stops reading, so longer passwords would
 * silently lose their tail. Supabase's own password policy (Dashboard → Auth → Providers → Email) applies on
 * top and surfaces as `weak_password`.
 */
export const passwordField = z
  .string()
  .min(8, 'must be at least 8 characters')
  .refine((p) => new TextEncoder().encode(p).length <= 72, 'must be at most 72 bytes')
  .refine((p) => p.trim().length > 0, 'must not be blank')
