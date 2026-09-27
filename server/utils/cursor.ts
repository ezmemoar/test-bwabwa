import { z } from 'zod'

/** Opaque keyset cursor: the (createdAt, id) of the last row on the previous page, base64url-encoded. */
export interface Cursor {
  createdAt: Date
  id: string
}

const cursorShape = z.tuple([z.iso.datetime({ offset: true }), z.uuid()])

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString('base64url')
}

export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined
  try {
    const [createdAt, id] = cursorShape.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')))
    return { createdAt: new Date(createdAt), id }
  } catch {
    throw problem(400, 'bad_request', 'Invalid cursor.')
  }
}

/** Fetch `limit + 1` rows, then call this: it trims the extra row and returns the next cursor if there is one. */
export function paginate<T extends { createdAt: Date; id: string }>(rows: T[], limit: number): { rows: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { rows, nextCursor: null }
  const page = rows.slice(0, limit)
  return { rows: page, nextCursor: encodeCursor(page[page.length - 1]!) }
}
