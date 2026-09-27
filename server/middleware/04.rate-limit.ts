// Coarse per-IP limit in front of everything else, so floods are turned away before any token is verified or
// any query runs. Health checks are exempt: load balancers poll them from a handful of IPs.
export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/v1/')) return
  await rateLimit(event, RateLimits.ip, clientIp(event))
})
