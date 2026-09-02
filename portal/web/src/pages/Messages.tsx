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
import { Empty, ErrorNote, PageHead, SectionHead, Spinner } from '../components/primitives'

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
  if (!threads) return <Spinner label="Loading conversations" />

  const active = threads.find((t) => t.id === activeId) ?? null

  return (
    <div>
      <PageHead
        title="Messages"
        detail="Threads here are mirrored to email in both directions."
        action={
          <button type="button" className="btn-primary" onClick={() => setComposing(true)}>
            New conversation
          </button>
        }
      />

      {composing && (
        <div className="mb-5">
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
        </div>
      )}

      {threads.length === 0 ? (
        <Empty
          title="No conversations yet."
          detail="Start one and we are notified. Replies land here and in your inbox."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,17rem)_1fr]">
          <ul className="panel divide-y divide-line overflow-hidden">
            {threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(thread.id)}
                  aria-current={thread.id === activeId ? 'true' : undefined}
                  className={`relative w-full px-4 py-3 text-left transition hover:bg-raised/60 ${
                    thread.id === activeId
                      ? 'bg-raised before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-ink'
                      : ''
                  }`}
                >
                  <p className="text-base font-medium text-ink">{thread.subject}</p>
                  <p className="mt-0.5 font-mono text-micro uppercase text-ink-3">
                    {dateLabel(thread.lastMessageAt)}
                    {thread.status === 'closed' && ' · closed'}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <div className="panel flex min-h-[26rem] flex-col">
            {active ? (
              <>
                <header className="border-b border-line px-4 py-3">
                  <h2 className="font-display text-h3 text-ink">{active.subject}</h2>
                  <p className="mt-0.5 font-mono text-micro uppercase text-ink-3">
                    {active.emailCcAddresses.length > 0
                      ? `also emailed to ${active.emailCcAddresses.join(', ')}`
                      : 'portal only — nobody is copied by email'}
                  </p>
                </header>

                <ol className="flex-1 space-y-3 overflow-y-auto p-4">
                  {messages.map((m) => {
                    const mine = m.authorUserId === user?.id
                    return (
                      <li
                        key={m.id}
                        className={`max-w-[85%] border px-3 py-2 text-base ${
                          mine
                            ? 'ml-auto border-ink bg-ink text-paper'
                            : 'border-line bg-raised/60 text-ink'
                        }`}
                      >
                        <p
                          className={`font-mono text-micro uppercase ${mine ? 'text-paper/60' : 'text-ink-3'}`}
                        >
                          {m.authorName} · {dateLabel(m.createdAt)}
                          {m.channel === 'email' && ' · by email'}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                      </li>
                    )
                  })}
                </ol>

                <ReplyBox
                  threadId={active.id}
                  onSent={(message) => setMessages((prev) => [...prev, message])}
                />
              </>
            ) : (
              <p className="p-6 text-base text-ink-3">Select a conversation.</p>
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
      onSent(await api.postMessage(threadId, body))
      setBody('')
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-line p-3">
      {error && <ErrorNote message={error} />}
      <textarea
        className="field min-h-[4.5rem] resize-y"
        placeholder="Write a reply"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy || body.trim() === ''}>
          {busy ? 'Sending' : 'Send'}
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
      await onCreated(
        await api.createThread({
          subject,
          body,
          buildingId: buildingId === '' ? null : buildingId,
          emailCcAddresses: cc
            .split(',')
            .map((a) => a.trim())
            .filter((a) => a !== ''),
        }),
      )
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="panel panel-pad space-y-3.5">
      <SectionHead title="New conversation" />
      {error && <ErrorNote message={error} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="subject">
            Subject
          </label>
          <input
            id="subject"
            className="field"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="field-label" htmlFor="thread-building">
            About a building · optional
          </label>
          <select
            id="thread-building"
            className="field"
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
        <label className="field-label" htmlFor="cc">
          Copy by email · comma separated
        </label>
        <input
          id="cc"
          className="field"
          placeholder="facilities@example.com, cfo@example.com"
          value={cc}
          onChange={(e) => setCc(e.target.value)}
        />
        <p className="mt-1 text-tiny text-ink-3">
          Everyone listed gets each reply by email, and replying to that email posts back into this
          thread.
        </p>
      </div>
      <div>
        <label className="field-label" htmlFor="thread-body">
          Message
        </label>
        <textarea
          id="thread-body"
          className="field min-h-[6rem] resize-y"
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
          {busy ? 'Starting' : 'Start conversation'}
        </button>
      </div>
    </form>
  )
}
