// Names that would let someone pass as Climbly staff in the forum. Checked after folding look-alikes, so
// "Cl1mbly_Supp0rt" or "ＡＤＭＩＮ" don't slip through, but per word, so "badminton_fan" or "supportive_friend"
// stay fine. Moderators and admins may use them.

const LOOKALIKES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '!': 'i', '|': 'l' }

/** A word that *is* one of these is reserved ("the.mods", "Team"). */
const RESERVED_WORDS = new Set(['admin', 'admins', 'administrator', 'mod', 'mods', 'moderator', 'moderators', 'support', 'official', 'staff', 'team', 'helpdesk'])
/** A word that *starts* with one of these is reserved ("AdminKate", "ModeratorJo", "OfficialClimb"). */
const RESERVED_PREFIXES = ['admin', 'moderator', 'official']

function fold(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[0134578@$!|]/g, (c) => LOOKALIKES[c] ?? c)
}

export function isReservedName(name: string): boolean {
  const folded = fold(name)
  const joined = folded.replace(/[^a-z]/g, '')
  // The brand anywhere, however it's split up or dressed ("c.l.i.m.b.l.y", "cl1mbly").
  if (joined.replace(/l/g, 'i').includes('ciimbiy')) return true
  // Spelled out with separators: "a d m i n", "m.o.d".
  if (RESERVED_WORDS.has(joined)) return true
  return folded
    .split(/[^a-z]+/)
    .filter(Boolean)
    .some((word) => RESERVED_WORDS.has(word) || RESERVED_PREFIXES.some((p) => word.startsWith(p)))
}
