// ---------------------------------------------------------------------------
// Conversations — portal threads that are also email threads.
//
// The CC list is shown on every thread rather than buried in settings, because
// "who else is seeing this?" is the first question anyone asks of a shared
// inbox, and the answer being visible is what makes people willing to use it.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Message, MessageThread } from '@hbs/shared'
import { api } from '../api/client'
import { messageFor, usePortal } from '../state/store'
import { dateLabel } from '../lib/format'
import { EmptyState, ErrorNote, SectionHeading, Spinner } from '../components/primitives'

export function Messages(): JSX.Element {
  const { portfolio, user } = usePortal()
  const [threads, setThreads] = useState<MessageThread[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [error, setError] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)

  const loadThreads = useCallback(async () => {
    try {
      const { threads: list } = await api.threads()
      setThreads(list)
      setActiveId((current) => current ?? list[0]?.id ?? null)
    } catch (err) {
      setError(messageFor(err))
    }
  }, [])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  useEffect(() => {
    if (!activeId) return
    api
      .thread(activeId)
      .then((t) => setMessages(t.messages))
      .catch((err: unknown) => setError(messageFor(err)))
  }, [activeId])

  if (error) return <ErrorNote message={error} />
  if (!threads) return <Spinner label="Loading conversations…" />

  const active = threads.find((t) => t.id === activeId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-forest-900">Messages</h1>
        <button type="button" className="btn-primary" onClick={() => setComposing(true)}>
          New conversation
        </button>
      </div>

      {composing && (
        <NewThreadForm
          buildings={(portfolio?.entries ?? []).map((e) => ({
            id: e.building.id,
            name: e.building.name,
          }))}
          onCancel={() => setComposing(false)}
          onCreated={async (thread) => {
            setComposing(false)
            await loadThreads()
            setActiveId(thread.id)
          }}
        />
      )}

      {threads.length === 0 ? (
        <EmptyState
          title="No conversations yet."
          detail="Start one and we will be notified. Replies land here and in your inbox."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
          <ul className="card divide-y divide-cream-200 overflow-hidden">
            {threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(thread.id)}
                  className={`w-full px-4 py-3 text-left transition hover:bg-cream-50 ${
                    thread.id === activeId ? 'bg-cream-100' : ''
                  }`}
                >
                  <p className="text-sm font-medium text-forest-900">{thread.subject}</p>
                  <p className="mt-0.5 text-xs text-forest-800/50">
                    {dateLabel(thread.lastMessageAt)}
                    {thread.status === 'closed' && ' · closed'}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <div className="card flex min-h-[24rem] flex-col">
            {active ? (
              <>
                <div className="border-b border-cream-200 px-4 py-3">
                  <h2 className="font-semibold text-forest-900">{active.subject}</h2>
                  <p className="mt-0.5 text-xs text-forest-800/60">
                    {active.emailCcAddresses.length > 0
                      ? `Also emailed to ${active.emailCcAddresses.join(', ')}`
                      : 'Portal only — nobody is copied by email'}
                  </p>
                </div>

                <ol className="flex-1 space-y-3 overflow-y-auto p-4">
                  {messages.map((m) => (
                    <li
                      key={m.id}
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                        m.authorUserId === user?.id
                          ? 'ml-auto bg-forest-500 text-cream-50'
                          : 'bg-cream-100 text-forest-900'
                      }`}
                    >
                      <p className="text-xs opacity-70">
                        {m.authorName} · {dateLabel(m.createdAt)}
                        {m.channel === 'email' && ' · by email'}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                    </li>
                  ))}
                </ol>

                <ReplyBox
                  threadId={active.id}
                  onSent={(message) => setMessages((prev) => [...prev, message])}
                />
              </>
            ) : (
              <div className="p-6 text-sm text-forest-800/60">Select a conversation.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ReplyBox({
  threadId,
  onSent,
}: {
  threadId: string
  onSent: (message: Message) => void
}): JSX.Element {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (body.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const message = (await api.postMessage(threadId, body)) as unknown as Message
      onSent(message)
      setBody('')
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-cream-200 p-3">
      {error && <ErrorNote message={error} />}
      <textarea
        className="input min-h-[4.5rem] resize-y"
        placeholder="Write a reply…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy || body.trim() === ''}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  )
}

function NewThreadForm({
  buildings,
  onCancel,
  onCreated,
}: {
  buildings: Array<{ id: string; name: string }>
  onCancel: () => void
  onCreated: (thread: MessageThread) => void | Promise<void>
}): JSX.Element {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [buildingId, setBuildingId] = useState('')
  const [cc, setCc] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const thread = await api.createThread({
        subject,
        body,
        buildingId: buildingId === '' ? null : buildingId,
        emailCcAddresses: cc
          .split(',')
          .map((a) => a.trim())
          .filter((a) => a !== ''),
      })
      await onCreated(thread)
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="card card-pad space-y-3">
      <SectionHeading title="New conversation" />
      {error && <ErrorNote message={error} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="subject">
            Subject
          </label>
          <input
            id="subject"
            className="input mt-1"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="thread-building">
            About a building (optional)
          </label>
          <select
            id="thread-building"
            className="input mt-1"
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value)}
          >
            <option value="">Not building-specific</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="cc">
          Copy by email (comma separated)
        </label>
        <input
          id="cc"
          className="input mt-1"
          placeholder="facilities@example.com, cfo@example.com"
          value={cc}
          onChange={(e) => setCc(e.target.value)}
        />
        <p className="mt-1 text-xs text-forest-800/60">
          Everyone listed gets each reply by email, and replying to that email posts back into this
          thread.
        </p>
      </div>
      <div>
        <label className="label" htmlFor="thread-body">
          Message
        </label>
        <textarea
          id="thread-body"
          className="input mt-1 min-h-[6rem] resize-y"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
        />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Starting…' : 'Start conversation'}
        </button>
      </div>
    </form>
  )
}
