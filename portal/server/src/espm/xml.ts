// ---------------------------------------------------------------------------
// XML in, XML out.
//
// ESPM speaks XML in both directions, and its responses are inconsistent about
// whether a repeated element arrives as an array or a lone object. Everything
// in here exists to make that inconsistency someone else's problem exactly
// once, at the parse boundary.
// ---------------------------------------------------------------------------

import { XMLBuilder, XMLParser } from 'fast-xml-parser'
import type { EspmErrorDetail, EspmLink } from './types.js'

const ATTR = '@_'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR,
  // Keep everything as strings and coerce deliberately below. Left to itself
  // the parser turns a postal code like "07030" into 7030 and a meter reading
  // of "0100" into 100.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
})

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR,
  format: true,
  suppressEmptyNode: true,
})

export function parseXml(xml: string): Record<string, unknown> {
  return parser.parse(xml) as Record<string, unknown>
}

export function buildXml(obj: Record<string, unknown>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(obj)}`
}

/**
 * ESPM omits an element entirely when there is one item, wraps it in an array
 * when there are several, and returns nothing at all when there are none.
 * Every list read goes through here.
 */
export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

export function str(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'object') {
    // fast-xml-parser represents `<tag attr="x">text</tag>` as an object with
    // a `#text` key; reach through for the text.
    const text = (value as Record<string, unknown>)['#text']
    return text === undefined ? undefined : String(text)
  }
  const s = String(value)
  return s.length === 0 ? undefined : s
}

export function num(value: unknown): number | undefined {
  const s = str(value)
  if (s === undefined) return undefined
  // ESPM sends thousands separators in some cost fields.
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : undefined
}

export function bool(value: unknown): boolean | undefined {
  const s = str(value)?.toLowerCase()
  if (s === undefined) return undefined
  return s === 'true' || s === 'yes' || s === '1'
}

/** Read an XML attribute off a parsed node. */
export function attr(node: unknown, name: string): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  return str((node as Record<string, unknown>)[`${ATTR}${name}`])
}

/**
 * Pull `<links><link .../></links>` out of any list response.
 *
 * ESPM nests these under different roots depending on the endpoint, so the
 * search is deliberately shallow-recursive rather than path-specific.
 */
export function extractLinks(parsed: Record<string, unknown>): EspmLink[] {
  const linksNode = findKey(parsed, 'links')
  if (!linksNode) return []
  const raw = asArray((linksNode as Record<string, unknown>)['link'])
  const out: EspmLink[] = []
  for (const node of raw) {
    const link = attr(node, 'link')
    const id = attr(node, 'id')
    if (!link) continue
    out.push({
      link,
      // Some responses carry the id only in the link path.
      id: id !== undefined ? Number(id) : idFromLink(link),
      hint: attr(node, 'hint'),
      linkDescription: attr(node, 'linkDescription'),
    })
  }
  return out
}

export function idFromLink(link: string): number {
  const match = /(\d+)\s*$/.exec(link.trim())
  return match?.[1] !== undefined ? Number(match[1]) : Number.NaN
}

/**
 * Depth-first search for the first node with the given key. ESPM wraps the
 * same payload under `<response>`, `<propertyList>` or nothing at all across
 * endpoints; this makes the caller indifferent to which.
 */
export function findKey(root: unknown, key: string): unknown {
  if (typeof root !== 'object' || root === null) return undefined
  const obj = root as Record<string, unknown>
  if (key in obj) return obj[key]
  for (const value of Object.values(obj)) {
    const found = findKey(value, key)
    if (found !== undefined) return found
  }
  return undefined
}

/** Extract ESPM's `<errors><error errorDescription="..."/></errors>` payload. */
export function extractErrors(parsed: Record<string, unknown>): EspmErrorDetail[] {
  const errorsNode = findKey(parsed, 'errors')
  if (!errorsNode) return []
  return asArray((errorsNode as Record<string, unknown>)['error']).map((node) => ({
    errorNumber: attr(node, 'errorNumber'),
    errorDescription:
      attr(node, 'errorDescription') ?? str(node) ?? 'Portfolio Manager returned an unspecified error.',
  }))
}
