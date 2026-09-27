import type { H3Event } from 'h3'
import { z } from 'zod'

function validationError(error: z.ZodError) {
  return problem(422, 'validation_failed', 'The request did not pass validation.', {
    errors: error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
  })
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input)
  if (!result.success) throw validationError(result.error)
  return result.data
}

/** JSON body, validated. Content type and size are enforced earlier by the request-guard middleware. */
export async function validBody<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.output<T>> {
  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    throw problem(400, 'invalid_json', 'The request body is not valid JSON.')
  }
  return parse(schema, body ?? {})
}

export function validQuery<T extends z.ZodType>(event: H3Event, schema: T): z.output<T> {
  return parse(schema, getQuery(event))
}

export function validParams<T extends z.ZodType>(event: H3Event, schema: T): z.output<T> {
  return parse(schema, getRouterParams(event, { decode: true }))
}

// Shared field schemas.

export const idParam = z.object({ id: z.uuid({ error: 'must be a UUID' }) })

/** Trimmed, NFC-normalised text with control characters (except newlines and tabs) stripped. */
export const cleanText = (min: number, max: number) =>
  z
    .string()
    .transform((s) =>
      s
        .normalize('NFC')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    )
    .pipe(z.string().min(min, `must be at least ${min} characters`).max(max, `must be at most ${max} characters`))

const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|xxx|io|co|tv|me|ly|gg|to|cc|ru|vip|link|site|online|app|club)\b/i

/**
 * The forum is for people quitting porn; links are the easiest way to push someone back. Posts and comments
 * with links are rejected with a dedicated code so the app can explain why.
 */
export function containsLink(text: string): boolean {
  return LINK.test(text)
}

export function assertNoLinks(text: string) {
  if (containsLink(text)) throw problem(422, 'links_not_allowed', 'Links are not allowed in the forum.')
}

export const pageLimit = (def: number, max: number) => z.coerce.number().int().min(1).max(max).default(def)
