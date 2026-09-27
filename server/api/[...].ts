// Unknown API paths answer with a problem+json 404 in dev too (production has no Vue renderer to fall back to).
export default defineEventHandler(() => {
  throw notFound('Endpoint')
})
