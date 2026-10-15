// ---------------------------------------------------------------------------
// Create the first real account.
//
// Until now the only way to get a user into the database was `npm run seed`,
// which also inserts demo organizations and buildings — fine for a laptop,
// wrong for a deployment. This is the production bootstrap: one account, no
// demo data.
//
//   npm run create-admin -- --email you@hbs.example --name "Your Name"
//   npm run create-admin -- --email ops@client.example --name "Ops" \
//                           --org "Meridian Property Group"
//
// With --org it creates a customer organization and its first admin; without,
// an HBS staff account that can see every client.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
import { getDb } from '../db/index.js'
import { createUser } from '../services/auth.js'
import { signUp } from '../services/tenancy.js'

interface Args {
  email?: string
  name?: string
  password?: string
  org?: string
  help?: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--help' || flag === '-h') {
      args.help = true
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) continue
    if (flag === '--email') args.email = value
    else if (flag === '--name') args.name = value
    else if (flag === '--password') args.password = value
    else if (flag === '--org') args.org = value
    if (flag?.startsWith('--')) i++
  }
  return args
}

/** Long enough that its randomness, not its shape, is the defence. */
function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

const USAGE = `
Create the first account in an empty deployment.

  --email <address>     required
  --name  <full name>   required
  --org   <name>        create a customer organization and its admin
                        (omit for an HBS staff account)
  --password <value>    optional; one is generated and printed if omitted

Reads the same DATABASE_PATH, SESSION_SECRET and CREDENTIAL_KEY as the server,
so run it against the same configuration.
`

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help === true || !args.email || !args.name) {
    console.log(USAGE)
    process.exit(args.help === true ? 0 : 1)
  }

  const email = args.email.trim().toLowerCase()
  if (!email.includes('@')) {
    console.error(`"${email}" does not look like an email address.`)
    process.exit(1)
  }

  const password = args.password ?? generatePassword()
  if (password.length < 10) {
    console.error('A password must be at least 10 characters.')
    process.exit(1)
  }

  const db = getDb()

  const existing = db
    .prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM users WHERE email = ? COLLATE NOCASE',
    )
    .get(email)
  if ((existing?.n ?? 0) > 0) {
    console.error(`An account already exists for ${email}.`)
    process.exit(1)
  }

  if (args.org !== undefined) {
    const { user, profile } = await signUp(db, {
      organizationName: args.org,
      fullName: args.name,
      email,
      password,
    })
    console.log(`\nCreated organization "${profile.name}" (${profile.slug})`)
    console.log(`Created admin  ${user.email}`)
  } else {
    const user = await createUser(db, {
      organizationId: null,
      email,
      fullName: args.name,
      role: 'hbs_staff',
      password,
    })
    console.log(`\nCreated HBS staff account  ${user.email}`)
  }

  if (args.password === undefined) {
    // Printed once, and never recoverable — the database holds only the hash.
    console.log(`\n  password: ${password}\n`)
    console.log('Store it now. It is not saved anywhere and cannot be shown again.')
  }

  // A deployment with no Portfolio Manager connection can sign people in but
  // cannot sync anything, and that is worth saying at setup time.
  const connections = db
    .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM espm_connections WHERE active = 1')
    .get()
  if ((connections?.n ?? 0) === 0) {
    console.log(
      '\nNote: no Portfolio Manager connection is configured yet. Sign in and add one\n' +
        'under Account → Portfolio Manager, or set ESPM_USERNAME and ESPM_PASSWORD for\n' +
        'the shared HBS account.',
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Could not create the account:', err)
    process.exit(1)
  })
