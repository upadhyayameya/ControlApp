// ---------------------------------------------------------------------------
// Encryption for credentials the portal must be able to replay.
//
// Self-service onboarding means a customer hands us their Portfolio Manager
// password, and ESPM only speaks HTTP Basic — so unlike a user password, we
// cannot hash it. It has to be recoverable, which makes how it is stored the
// most security-sensitive decision in the codebase.
//
// AES-256-GCM with a key held outside the database (CREDENTIAL_KEY). A stolen
// database file alone is not enough to use the credentials; the key has to be
// stolen too, from the environment or the secret manager that supplies it.
// Each record gets a fresh random IV and the GCM tag is stored alongside, so
// tampering with a stored ciphertext fails to decrypt rather than yielding a
// different plaintext.
//
// The honest limits: a process with the key and read access to the database
// can decrypt everything, and this offers nothing against that. Moving to a
// KMS or a dedicated secret store — where the key never enters this process —
// is the next step, and `encryptSecret`/`decryptSecret` are the seam for it.
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'

export interface SealedSecret {
  ciphertext: string
  iv: string
  tag: string
}

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // 96 bits, the size GCM is specified for

/**
 * A 32-byte key from CREDENTIAL_KEY. Any length of input is accepted and
 * hashed to the right size, so an operator does not have to produce exactly
 * 32 bytes of base64 to get a correct deployment.
 */
function key(): Buffer {
  return createHash('sha256').update(config.credentialKey, 'utf8').digest()
}

export function encryptSecret(plaintext: string): SealedSecret {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

/**
 * Returns null rather than throwing when a record cannot be decrypted — a
 * rotated key or a corrupted row should surface as "this connection needs
 * reconnecting", not as a 500 on an unrelated page.
 */
export function decryptSecret(sealed: Partial<SealedSecret>): string | null {
  if (!sealed.ciphertext || !sealed.iv || !sealed.tag) return null
  try {
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(sealed.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

/** Random, URL-safe, and long enough that guessing is not a strategy. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Invitation tokens are stored as hashes, so the database never holds anything
 * that can accept an invitation. SHA-256 without a salt is right here and wrong
 * for passwords: the input is already 256 bits of entropy, so there is nothing
 * for a dictionary attack to work with.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
