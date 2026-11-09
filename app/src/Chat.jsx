import React, { useEffect, useRef, useState } from 'react';

async function request(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    signal: options.signal,
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Chat is unavailable.'), { status: response.status });
  return data;
}

const threadPath = (id) => `/api/matches/${encodeURIComponent(id)}/messages`;

export default function Chat() {
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [signIn, setSignIn] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const retry = useRef(null);
  const thread = useRef(null);
  const lastMessageId = messages.at(-1)?.id;

  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [lastMessageId]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer;
    async function refresh() {
      try {
        const current = await request('/api/chat', { signal });
        const conversation = current.matched
          ? await request(threadPath(current.peer.id), { signal }) : { messages: [] };
        if (signal.aborted) return;
        setStatus(current);
        setMessages(conversation.messages);
        setSignIn(false);
        setLoadError('');
      } catch (failure) {
        if (signal.aborted) return;
        if (failure.status === 401 || failure.status === 403) {
          setStatus(null);
          setMessages([]);
          setSignIn(failure.status === 401);
        }
        setLoadError(failure.status === 401 ? '' : failure.message);
      } finally {
        if (!signal.aborted) timer = setTimeout(refresh, 3000);
      }
    }
    if (!busy) refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [busy]);

  async function run(action) {
    setBusy(true);
    setError('');
    try { await action(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  function authenticate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const token = new FormData(form).get('token').trim();
    run(async () => {
      await request('/api/demo/session', { method: 'POST', body: { token } });
      form.reset();
      setMessages([]);
      setText('');
      retry.current = null;
      setSignIn(false);
    });
  }

  function send(event) {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy || !status?.matched) return;
    if (retry.current?.text !== value) retry.current = { text: value, request_id: crypto.randomUUID() };
    run(async () => {
      const message = await request(threadPath(status.peer.id), { method: 'POST', body: retry.current });
      setMessages((previous) => previous.some(({ id }) => id === message.id) ? previous : [...previous, message]);
      retry.current = null;
      setText('');
    });
  }

  return <section className="chat-panel" aria-label="Match chat">
    {(error || loadError) && <p className="info-box" role="alert">{error || loadError}</p>}
    {signIn ? <form onSubmit={authenticate}>
      <p className="muted">Sign in with your assigned demo token to chat across devices.</p>
      <label className="field">Demo token<input name="token" type="password" required autoComplete="off" /></label>
      <button type="submit" className="button primary" disabled={busy}>Sign in to chat</button>
    </form> : status ? <>
      <p className="eyebrow">SIGNED IN AS {status.self.name}</p>
      <h3>{status.peer.name}</h3>
      {status.matched ? <>
        <div ref={thread} className="chat-thread" role="log" aria-label="Conversation" tabIndex={0}>
          {!messages.length && <p className="muted">Say hello or ask about something you both care about.</p>}
          {messages.map((message) => {
            const mine = message.sender_id === status.self.id;
            return <article key={message.id} className={mine ? 'chat-message mine' : 'chat-message'}>
              <small>{mine ? 'You' : status.peer.name} · <time dateTime={message.sent_at}>{new Date(message.sent_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></small>
              <p>{message.text}</p>
            </article>;
          })}
        </div>
        <form onSubmit={send}>
          <label className="field">Message<textarea rows="3" maxLength={1000} value={text} onChange={(event) => setText(event.target.value)} disabled={busy} /></label>
          <button type="submit" className="button primary" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send message'}</button>
        </form>
      </> : <>
        <p className="muted">{status.liked ? 'Waiting for them to connect back.' : 'Chat opens when you both choose to connect.'}</p>
        {!status.liked && <button type="button" className="button primary" disabled={busy} onClick={() => run(() => request(
          `/api/swipes/people/${encodeURIComponent(status.peer.id)}`, { method: 'PUT', body: { direction: 'right' } },
        ))}>Connect</button>}
      </>}
    </> : !loadError && <p role="status">Opening chat…</p>}
  </section>;
}
