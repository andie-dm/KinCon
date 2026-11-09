import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { cards, defaultProfile, findCard, identities, intents, preferences } from './fixtures.mjs';
import { actionKey, conversation, feed, freshState, incomingRequests, introFor, isMatched, isSaved, MAX_MESSAGE_LENGTH, parseState, requestStatus, respond, sendMessage, STORAGE_KEY, swipe } from './demo.mjs';
import './styles.css';

function Icon({ name, size = 20, ...props }) {
  const paths = {
    discover: <><path d="m16 8-3 5-5 3 3-5Z" /><circle cx="12" cy="12" r="9" /></>,
    research: <><path d="M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4Z" /><path d="M12 5v15" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" /></>,
    groups: <><circle cx="12" cy="7" r="3" /><path d="M6 21v-2a6 6 0 0 1 12 0v2M3 8a3 3 0 0 1 3-3M1 17a5 5 0 0 1 4-5M21 8a3 3 0 0 0-3-3m5 12a5 5 0 0 0-4-5" /></>,
    saved: <path d="M6 3h12v18l-6-4-6 4Z" />,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4" /></>,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="16" cy="17" r="3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M15 8V3H3v13h5" /></>,
    undo: <><path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5" /></>,
    bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z" /><path d="M10 21a2 2 0 0 0 4 0" /></>,
    chat: <path d="M4 5h16v11H9l-5 4Z" />,
    send: <path d="m4 12 16-8-6 16-3-7Z" />,
    connect: <><circle cx="9.5" cy="8" r="3.5" /><path d="M3 20v-1a6.5 6.5 0 0 1 11.5-4.2M18.5 13v6m-3-3h6" /></>,
    bulb: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.5 1.1-2.1A6 6 0 0 0 12 3Z" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.spark}</svg>;
}

function ResearchArt({ theme }) {
  return <svg className={`research-art ${theme}`} viewBox="0 0 600 270" fill="none" aria-hidden="true">
    <defs>
      <pattern id={`grid-${theme}`} width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#809b8f" opacity=".27" /></pattern>
      <linearGradient id={`orb-${theme}`} x1="140" y1="30" x2="380" y2="260" gradientUnits="userSpaceOnUse"><stop stopColor="#c6dfce" /><stop offset="1" stopColor="#8fb9a6" /></linearGradient>
    </defs>
    <path fill={`url(#grid-${theme})`} d="M0 0h600v270H0z" />
    <circle cx="314" cy="134" r="100" fill={`url(#orb-${theme})`} />
    <ellipse cx="314" cy="134" rx="151" ry="48" transform="rotate(-25 314 134)" stroke="#567765" strokeWidth="1.3" />
    <ellipse cx="314" cy="134" rx="118" ry="78" transform="rotate(32 314 134)" stroke="#fff" strokeWidth="1.2" strokeDasharray="4 5" />
    <path d="M136 212c40 15 60-10 87-48s42-57 71-45 33 74 68 67 34-67 88-65" stroke="#f8f6ea" strokeWidth="22" strokeLinecap="round" />
    <path d="M136 212c40 15 60-10 87-48s42-57 71-45 33 74 68 67 34-67 88-65" stroke="#e67f62" strokeWidth="14" strokeLinecap="round" />
    <circle cx="136" cy="212" r="11" fill="#223f37" /><circle cx="450" cy="121" r="12" fill="#223f37" />
    <path d="m189 75 4-11 4 11 11 4-11 4-4 11-4-11-11-4ZM444 204l3-8 3 8 8 3-8 3-3 8-3-8-8-3Z" fill="#506e60" />
    <circle cx="421" cy="50" r="5" fill="#e67f62" /><circle cx="181" cy="158" r="3" fill="#567765" />
    <path d="M70 87h61m-61 8h33M459 228h62m-35 8h35" stroke="#8ba598" strokeWidth="2" />
    <text x="69" y="75" fill="#567765" fontSize="9" fontFamily="monospace">IDEAS IN MOTION</text>
  </svg>;
}

function Avatar({ person, small = false }) {
  return <span className={`avatar ${person.color || 'peach'} ${small ? 'small' : ''}`}>{person.initials || person.name?.split(' ').map((part) => part[0]).join('')}</span>;
}

function CardArt({ card }) {
  if (card.type === 'research') return <div className="art-wrap"><span className="art-label">THE NEXT IDEA STARTS HERE</span><ResearchArt theme={card.theme} /><span className="art-caption">a small spark of curiosity</span></div>;
  if (card.type === 'people') return <div className={`person-art ${card.color}`}><span className="orbit one" /><span className="orbit two" /><span className="person-star">✳</span><Avatar person={card} /><span className="person-label">a conversation waiting to happen</span></div>;
  return <div className={`group-art ${card.color}`}><span className="art-label">BETTER IN GOOD COMPANY</span><div className="group-faces"><span>JC</span><span>SO</span><span>YOU</span></div><span className="art-caption">a few people. a shared curiosity.</span></div>;
}

function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={wide ? 'modal wide' : 'modal'} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-head"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>
    {children}
  </dialog>;
}

function ProfileForm({ profile, onSave }) {
  return <form onSubmit={(event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    onSave(values);
  }}>
    <p className="muted">A few small choices. More meaningful conversations.</p>
    <fieldset><legend><span className="step">01</span> What brings you here?</legend><div className="intent-grid">{intents.map((intent) => <label className="choice" key={intent}><input type="radio" name="intent" value={intent} defaultChecked={profile.intent === intent} required /><span>{intent}</span></label>)}</div></fieldset>
    <fieldset><legend><span className="step">02</span> Give a little. Learn a little.</legend><label className="field">I can help with<input name="offers" defaultValue={profile.offers} placeholder="Imitation learning, Python..." required maxLength={200} /></label><label className="field">I want to learn<input name="asks" defaultValue={profile.asks} placeholder="Flow matching, Robotics..." required maxLength={200} /></label><p className="fine">Separate topics with commas. You can change these anytime.</p></fieldset>
    <fieldset><legend><span className="step">03</span> Your kind of conversation</legend><label className="field">Conversation preference<select name="preference" defaultValue={profile.preference}>{preferences.map((preference) => <option key={preference}>{preference}</option>)}</select></label></fieldset>
    <button className="button primary full" type="submit">Find my people <Icon name="arrow" /></button>
  </form>;
}

function ChatWindow({ me, other, thread, draft, onSend }) {
  const endRef = useRef(null);
  const [text, setText] = useState(thread.length ? '' : draft);
  const first = other.title.split(' ')[0];
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread.length]);
  return <div className="chat">
    <div className="chat-thread" aria-live="polite">
      {thread.length === 0 && <p className="fine chat-empty">You're connected. Say hello and suggest a place to meet.</p>}
      {thread.map((message, index) => <div key={`${message.at}-${index}`} className={message.from === me ? 'bubble mine' : 'bubble theirs'}><p>{message.body}</p><small>{message.from === me ? 'You' : first} · {new Date(message.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div>)}
      <span ref={endRef} />
    </div>
    <form className="chat-compose" onSubmit={(event) => { event.preventDefault(); if (onSend(text)) setText(''); }}>
      <label className="field">Message {first}<textarea rows="3" value={text} maxLength={MAX_MESSAGE_LENGTH} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} /></label>
      <button className="button primary" type="submit" disabled={!text.trim()}><Icon name="send" size={17} /> Send</button>
    </form>
    <p className="fine">Local demo: messages stay in this browser. Open a second tab as {first} to reply live.</p>
  </div>;
}

function App() {
  const [initial] = useState(() => {
    try { return { state: parseState(localStorage.getItem(STORAGE_KEY)), error: '' }; }
    catch (error) { return { state: freshState(), error: `Cannot load local demo: ${error.message}` }; }
  });
  const [state, setState] = useState(initial.state);
  const [error, setError] = useState(initial.error);
  const [actor, setActor] = useState('alex');
  const [view, setView] = useState('discover');
  const [deck, setDeck] = useState('research');
  const [format, setFormat] = useState('All');
  const [paperId, setPaperId] = useState(null);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState('');
  const [lastAction, setLastAction] = useState(null);
  const [drag, setDrag] = useState(0);
  const [pinned, setPinned] = useState(null);
  const gesture = useRef(null);
  const identity = identities.find(({ id }) => id === actor);
  const profile = state.profiles[actor] || defaultProfile;
  const upcoming = useMemo(() => feed(state, actor, deck, format, paperId), [state, actor, deck, format, paperId]);
  const current = pinned || upcoming[0];
  // Connected people include requests you accepted, not only people you asked.
  const matches = cards.filter((card) => card.type === 'people' && card.id !== actor && isMatched(state, actor, card.id));
  const saved = [...cards.filter((card) => card.type !== 'people' && isSaved(state, actor, card)), ...matches];
  const pending = cards.filter((card) => card.type === 'people' && isSaved(state, actor, card) && !isMatched(state, actor, card.id));
  const requests = incomingRequests(state, actor).map((id) => findCard('people', id)).filter(Boolean);
  const joined = cards.filter((card) => card.type === 'groups' && state.joins[actionKey(actor, 'groups', card.id)]);
  const modalMatched = modal?.card?.type === 'people' && isMatched(state, actor, modal.card.id);

  function commit(next) {
    if (error) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setState(next);
      return true;
    } catch (failure) {
      setError(`Your changes could not be saved: ${failure.message}. Enable browser storage before continuing.`);
      return false;
    }
  }

  useEffect(() => {
    function sync(event) {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      try { setState(parseState(event.newValue)); setError(''); }
      catch (failure) { setError(`Cannot sync local demo: ${failure.message}`); }
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);

  function act(direction, card = current) {
    if (!card || error) return;
    const next = swipe(state, actor, card, direction);
    if (!commit(next)) return;
    setLastAction({ actor, card });
    setPinned(null);
    setDrag(0);
    if (direction === 'right' && card.type === 'people') {
      const first = card.title.split(' ')[0];
      if (isMatched(next, actor, card.id)) setModal({ kind: 'match', card });
      setNotice(isMatched(next, actor, card.id) ? `You and ${first} are both interested. Your chat is open.` : `Request sent. ${first} will be notified and can accept or decline.`);
    } else {
      setNotice(direction === 'left' ? 'Passed. On to your next discovery.' : card.type === 'groups' ? 'Meetup saved. Join separately to confirm attendance.' : 'Research saved to your collection.');
    }
  }

  useEffect(() => {
    function onKey(event) {
      if (view !== 'discover' || modal || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
        || /INPUT|TEXTAREA|SELECT|BUTTON|A/.test(event.target.tagName) || event.target.isContentEditable) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        act(event.key === 'ArrowLeft' ? 'left' : 'right');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function undo() {
    if (!lastAction || lastAction.actor !== actor) return;
    const key = actionKey(actor, lastAction.card.type, lastAction.card.id);
    const swipes = { ...state.swipes };
    delete swipes[key];
    const buddies = { ...state.buddies };
    const joins = { ...state.joins };
    delete buddies[key];
    delete joins[key];
    if (commit({ ...state, swipes, buddies, joins })) { setLastAction(null); setNotice('Last swipe undone.'); }
  }

  function shareBuddy(card) {
    if (!commit({ ...state, buddies: { ...state.buddies, [actionKey(actor, 'research', card.id)]: true } })) return;
    setPaperId(card.id);
    setDeck('people');
    setView('discover');
    setModal(null);
    setNotice('You explicitly shared buddy interest for this poster.');
  }

  function joinGroup(card) {
    if (!card.place) { setNotice('The host needs to confirm a public meeting point before you can join.'); return; }
    if (commit({ ...swipe(state, actor, card, 'right'), joins: { ...state.joins, [actionKey(actor, 'groups', card.id)]: true } })) {
      setNotice('You joined the meetup. Meeting details are in Saved.');
    }
  }

  function switchActor(id) {
    setActor(id);
    setPaperId(null);
    setLastAction(null);
    setModal(null);
    setNotice(`Now exploring as ${identities.find((person) => person.id === id).name.split(' ')[0]}.`);
  }


  function answer(card, decision) {
    if (!commit(respond(state, actor, card.id, decision))) return;
    if (decision === 'accepted') { setModal({ kind: 'chat', card }); setNotice(`You accepted ${card.title.split(' ')[0]}'s request. Say hello!`); }
    else setNotice('Request declined. They will only see that it was not accepted.');
  }

  function send(card, text) {
    try { return commit(sendMessage(state, actor, card.id, text)); }
    catch (failure) { setNotice(failure.message); return false; }
  }

  function detailBody(card) {
    const matched = card.type === 'people' && isMatched(state, actor, card.id);
    const liked = isSaved(state, actor, card);
    const status = card.type === 'people' ? requestStatus(state, actor, card.id) : 'none';
    const incoming = card.type === 'people' && requestStatus(state, card.id, actor) === 'pending';
    const first = card.title.split(' ')[0];
    return <>
      <p className="eyebrow">{card.type === 'research' ? 'Fictional research fixture' : card.type === 'people' ? 'Fictional opted-in attendee' : 'Fictional hosted meetup'}</p>
      <h3 className="detail-subtitle">{card.subtitle}</h3>
      <p className="muted">{card.summary || card.subtitle}</p>
      {card.type === 'research' && <><p className="byline">{card.authors}</p><div className="info-box"><Icon name="clock" /><span>{card.occurrences.length ? `${card.occurrences[0].date} · ${card.occurrences[0].start}–${card.occurrences[0].end} ET (Philadelphia)` : 'Time or room unconfirmed'}</span></div>{card.occurrences.length > 0 && <div className="info-box"><Icon name="pin" /><span>{card.occurrences[0].room} · illustrative session only</span></div>}<p className="fine">No author attendance is implied. Paper, authors, and schedule in this local prototype are unverified fixtures.</p></>}
      {card.type === 'people' && <><div className="offer-grid"><div><span className="eyebrow">CAN HELP WITH</span><p>{card.offers}</p></div><div><span className="eyebrow">WANTS TO LEARN</span><p>{card.asks}</p></div></div><p className="fine">{card.evidence.join(' · ')}</p>{matched ? <button className="button primary full" onClick={() => setModal({ kind: 'chat', card })}><Icon name="bulb" /> Open chat with {first}</button> : incoming ? <><p className="info-box"><Icon name="bell" />{first} sent you a chat request.</p><div className="request-actions"><button className="button pass-button" onClick={() => answer(card, 'rejected')}><Icon name="close" />Decline</button><button className="button primary" onClick={() => answer(card, 'accepted')}><Icon name="check" />Accept</button></div></> : liked && <><p className="info-box"><Icon name={status === 'not_accepted' ? 'close' : 'clock'} />{status === 'not_accepted' ? `${first} didn't accept this request.` : `Request sent. Waiting for ${first} to accept.`}</p><label className="field">Your first message (prefills the chat)<textarea rows="4" value={introFor(state, actor, card)} onChange={(event) => commit({ ...state, drafts: { ...state.drafts, [actionKey(actor, 'people', card.id)]: event.target.value } })} /></label></>}<p className="fine">{first} sees your name and profile with the request. Messages stay in this browser in the local demo.</p></>}
      {card.type === 'groups' && <><div className="info-box"><Icon name="clock" />March 1, 2025 · {card.time} ET (Philadelphia)</div><div className="info-box"><Icon name="pin" />{card.place || 'Meeting point unconfirmed'}</div><p className="muted">Hosted by {card.host} · {card.audience}<br />{card.style}</p><button className="button primary full" disabled={!card.place || state.joins[actionKey(actor, 'groups', card.id)]} onClick={() => joinGroup(card)}>{state.joins[actionKey(actor, 'groups', card.id)] ? 'Joined meetup' : card.place ? 'Join meetup' : 'Waiting for a meeting point'}<Icon name="check" /></button></>}
      {card.type === 'research' && liked && card.format === 'Poster' && <button className="button primary full" onClick={() => shareBuddy(card)}>Open to a buddy for this poster <Icon name="people" /></button>}
      {!liked && card.type !== 'groups' && <button className="button primary full" onClick={() => { act('right', card); if (card.type !== 'people' || !isMatched(swipe(state, actor, card, 'right'), actor, card.id)) setModal(null); }}>{card.type === 'people' ? 'Send chat request' : 'Save research'}<Icon name={card.type === 'people' ? 'connect' : 'saved'} /></button>}
    </>;
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="KinCon home"><span className="brand-mark"><Icon name="spark" size={25} /></span>KinCon<span className="brand-period">.</span></a>
      <div className="event-badge"><span className="live-dot" /> AAAI-25 replay <span className="city">Philadelphia, PA</span></div>
      <span className="nav-label">MAKE A CONNECTION</span>
      <nav className="main-nav" aria-label="Main navigation">
        {[['discover', 'discover', 'Discover'], ['saved', 'saved', 'Saved'], ['matches', 'chat', 'Chats']].map(([id, icon, label]) => <button key={id} className={view === id ? 'nav-item active' : 'nav-item'} onClick={() => setView(id)}><Icon name={icon} /><span>{label}</span>{id !== 'discover' && <span className="nav-count">{id === 'saved' ? saved.length : matches.length}</span>}</button>)}
      </nav>
      <div className="sidebar-note"><span className="little-flower">✳</span><h3>Your next great idea<br />might be a hello away.</h3><p>Stay curious. Be kind.<br />Find your kind of people.</p></div>
      <div className="sidebar-bottom"><button className="profile-link" onClick={() => setModal({ kind: 'profile' })}><Avatar person={identity} small /><span><strong>{identity.name}</strong><small>Edit interests & preferences</small></span><Icon name="settings" size={17} /></button><span className="fine">Made for conversations, not connections counts.</span></div>
    </aside>

    <div className="workspace">
      <header className="topbar"><span><span className="tiny-flower">✳</span> A little curiosity goes a long way.</span><div className="topbar-actions"><button className="icon-button notify-button" aria-label={`Chat requests${requests.length ? `, ${requests.length} new` : ''}`} onClick={() => setModal({ kind: 'requests' })}><Icon name="bell" size={17} />{requests.length > 0 && <span className="notify-badge">{requests.length}</span>}</button><button className="icon-button" aria-label="Edit interests and preferences" onClick={() => setModal({ kind: 'profile' })}><Icon name="settings" size={17} /></button><label className="identity-picker"><span>Demo as</span><select aria-label="Demo identity" value={actor} onChange={(event) => switchActor(event.target.value)}>{identities.map((person) => <option value={person.id} key={person.id}>{person.name.split(' ')[0]}</option>)}</select></label></div></header>
      <div className="demo-banner"><span className="demo-pill">LOCAL DEMO</span><span>Fictional data. Historical replay. Chats stay in this browser.</span></div>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setModal({ kind: 'reset' })}>Reset local data</button></div>}

      <div className="content-grid">
        <main id="main-content">
          <div className="page-heading"><p className="eyebrow">{view === 'discover' ? 'LESS SCROLLING. MORE SERENDIPITY.' : 'GOOD THINGS, KEPT CLOSE.'}</p><h1>{view === 'discover' ? <>Good research.<br /><span>Better company.</span></> : view === 'saved' ? <>Your little<br /><span>collection of possibility.</span></> : <>A shared interest.<br /><span>A real starting point.</span></>}</h1><p className="page-subtitle">{view === 'discover' ? 'Find an idea you love. Meet someone who gets it.' : view === 'saved' ? 'The ideas, people, and meetups you want to come back to.' : 'A chat opens when someone accepts your request.'}</p></div>

          {view === 'discover' ? <>
            <div className="deck-tabs" role="tablist" aria-label="Discovery deck" onKeyDown={(event) => {
              const ids = ['research', 'people', 'groups'];
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (ids.indexOf(deck) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
              setDeck(ids[next]);
              setPinned(null);
              setDrag(0);
              event.currentTarget.querySelectorAll('[role="tab"]')[next].focus();
            }}>{[['research', 'Research'], ['people', 'People'], ['groups', 'Groups']].map(([id, label]) => <button key={id} role="tab" id={`tab-${id}`} tabIndex={deck === id ? 0 : -1} aria-selected={deck === id} aria-controls="discovery-panel" className={deck === id ? 'selected' : ''} onClick={() => { setDeck(id); setPinned(null); setDrag(0); }}><Icon name={id} size={18} />{label}</button>)}</div>
            <div className="deck-toolbar"><span>{deck === 'research' ? 'A new idea to follow' : deck === 'people' ? 'A new person to meet' : 'A small group to belong to'}</span>{deck === 'research' ? <div className="format-filters" aria-label="Research format">{['All', 'Oral', 'Poster'].map((value) => <button key={value} aria-pressed={format === value} onClick={() => setFormat(value)}>{value === 'All' ? 'All' : `${value}s`}</button>)}</div> : <span className="fine">{upcoming.length} to discover</span>}</div>
            {deck === 'people' && paperId && <div className="buddy-context"><Icon name="people" size={17} /><span>Buddy discovery: {findCard('research', paperId).subtitle}</span><button aria-label="Clear poster context" className="icon-button" onClick={() => setPaperId(null)}><Icon name="close" size={15} /></button></div>}
            <section id="discovery-panel" role="tabpanel" aria-labelledby={`tab-${deck}`}>
              {current ? <div className="card-stack">
                <article className={`discovery-card ${drag ? 'dragging' : ''}`} style={{ transform: `translateX(${drag}px) rotate(${drag / 25}deg)` }}
                  onPointerDown={(event) => {
                    if (event.target.closest('button, a') || event.button !== 0) return;
                    gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId, card: current };
                    setPinned(current);
                  }}
                  onPointerMove={(event) => {
                    const start = gesture.current;
                    if (!start || start.id !== event.pointerId) return;
                    const dx = event.clientX - start.x;
                    const dy = event.clientY - start.y;
                    if (Math.abs(dy) > 25 && Math.abs(dy) > Math.abs(dx)) { gesture.current = null; setDrag(0); setPinned(null); return; }
                    if (Math.abs(dx) > 10) { event.currentTarget.setPointerCapture(event.pointerId); setDrag(Math.max(-150, Math.min(150, dx))); }
                  }}
                  onPointerUp={(event) => {
                    const start = gesture.current;
                    gesture.current = null;
                    if (start && start.id === event.pointerId && Math.abs(event.clientX - start.x) > 85) act(event.clientX > start.x ? 'right' : 'left', start.card);
                    setDrag(0); setPinned(null);
                  }}
                  onPointerCancel={() => { gesture.current = null; setPinned(null); setDrag(0); }}>
                  {Math.abs(drag) > 40 && <div className={`swipe-stamp ${drag > 0 ? 'save' : 'pass'}`}>{drag > 0 ? (deck === 'people' ? 'INTERESTED' : 'SAVE') : 'PASS'}</div>}
                  <CardArt card={current} />
                  <div className="card-content"><div className="card-meta"><span className="category-label"><span className="live-dot" />{deck === 'research' ? `${current.format.toUpperCase()} · RESEARCH FIXTURE` : deck === 'people' ? `${current.stage.toUpperCase()}` : 'HOSTED MEETUP · FICTIONAL'}</span><button className="icon-button" aria-label={`Details about ${current.title}`} onClick={() => setModal({ kind: 'detail', card: current })}><Icon name="arrow" size={19} /></button></div><h2>{current.title}</h2><p className="card-subtitle">{current.subtitle}</p>{deck === 'research' && <p className="byline">{current.authors}</p>}{deck === 'people' && <p className="byline">Offers {current.offers.toLowerCase()}</p>}{deck === 'groups' && <p className="byline">Hosted by {current.host} · {current.size}/{current.capacity} fixture spots</p>}<div className="tags">{current.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="why"><Icon name="spark" size={17} /><p>{current.reason}</p></div><div className="card-foot"><span><Icon name={deck === 'people' ? 'people' : 'pin'} size={15} />{deck === 'research' ? current.occurrences[0]?.room || 'Time or room unconfirmed' : deck === 'groups' ? current.place || 'Meeting point unconfirmed' : 'Opted in · fictional attendee'}</span><button className="text-button" onClick={() => setModal({ kind: 'detail', card: current })}>Details <Icon name="arrow" size={14} /></button></div></div>
                </article>
              </div> : <div className="empty-state"><span className="empty-icon"><Icon name="spark" size={32} /></span><h2>A little room for serendipity.</h2><p>You've explored this {format !== 'All' && deck === 'research' ? format.toLowerCase() : ''} deck. Your saved discoveries are waiting for you.</p><button className="button primary" onClick={() => setView('saved')}>Open Saved <Icon name="arrow" /></button></div>}
            </section>
            <div className="swipe-actions"><button className="undo-button icon-button" disabled={!lastAction || lastAction.actor !== actor || !!error} onClick={undo} aria-label="Undo last swipe"><Icon name="undo" size={20} /></button><button className="button pass-button" disabled={!current || !!error} onClick={() => act('left')}><Icon name="close" />Pass<span className="key-hint">←</span></button><button className="button save-button" disabled={!current || !!error} onClick={() => act('right')}><Icon name={deck === 'people' ? 'connect' : 'saved'} />{deck === 'people' ? 'Interested' : 'Save'}<span className="key-hint">→</span></button></div>
            <p className="gesture-hint">Swipe a card or use <kbd>←</kbd> <kbd>→</kbd> to explore. No pressure, ever.</p>
          </> : <div className="saved-content">
            {(view === 'matches' ? matches : saved).length === 0 && <div className="empty-state"><span className="empty-icon"><Icon name={view === 'matches' ? 'people' : 'saved'} size={30} /></span><h2>{view === 'matches' ? 'Good conversations take two.' : 'Start a collection of good ideas.'}</h2><p>{view === 'matches' ? 'Tap Interested on someone in People. They get a request, and your chat opens when they accept. Switch the demo identity to try both sides.' : 'Save a paper or a group as you explore. Accepted chats appear here too.'}</p><button className="button primary" onClick={() => { setView('discover'); if (view === 'matches') setDeck('people'); }}>Keep exploring <Icon name="arrow" /></button></div>}
            {(view === 'matches' ? matches : saved).map((card) => <article className="saved-card" key={`${card.type}-${card.id}`}><span className={`saved-icon ${card.color || 'mint'}`}><Icon name={card.type === 'people' && view === 'matches' ? 'bulb' : card.type} size={23} /></span><div><span className="eyebrow">{card.type === 'people' ? `CONNECTED · ${conversation(state, actor, card.id).length} ${conversation(state, actor, card.id).length === 1 ? 'MESSAGE' : 'MESSAGES'}` : card.type === 'research' ? `${card.format} · FICTIONAL` : state.joins[actionKey(actor, 'groups', card.id)] ? 'MEETUP · JOINED' : 'MEETUP · SAVED, NOT JOINED'}</span><h3>{card.title}</h3><p>{card.subtitle}</p>{card.type === 'research' && card.format === 'Poster' && <button className="text-button buddy-link" onClick={() => shareBuddy(card)}><Icon name="people" size={16} />{state.buddies[actionKey(actor, 'research', card.id)] ? 'Buddy interest shared · find people' : 'Open to a buddy for this poster'}</button>}</div><button className="icon-button" aria-label={`Open ${card.title}`} onClick={() => setModal({ kind: card.type === 'people' ? 'chat' : 'detail', card })}><Icon name={card.type === 'people' ? 'chat' : 'arrow'} /></button></article>)}
            {view === 'matches' && pending.length > 0 && <div className="pending-section"><h3>Requests you sent <span className="count-pill">{pending.length}</span></h3><p className="fine">They can accept or decline. A chat opens on acceptance.</p>{pending.map((card) => <button className="pending-person" key={card.id} onClick={() => setModal({ kind: 'detail', card })}><Avatar person={card} small /><span>{card.title}<small>{requestStatus(state, actor, card.id) === 'not_accepted' ? 'Not accepted' : 'Waiting for a response'}</small></span><Icon name="arrow" size={17} /></button>)}</div>}
          </div>}
          <footer className="main-footer"><span>AAAI-25 replay · March 1, 2025 · 12:00 PM ET · version {__APP_VERSION__}</span><button onClick={() => setModal({ kind: 'reset' })}>Reset demo</button></footer>
        </main>

        <aside className="context-panel">
          <div className="today-label"><span className="live-dot" /> YOUR CONFERENCE, YOUR WAY</div>
          <section className="intent-panel"><span className="intent-icon"><Icon name="spark" size={25} /></span><p className="eyebrow">YOU'RE HERE TO</p><h2>{profile.intent === 'Find a poster buddy' ? <>Find a poster<br />buddy.</> : profile.intent}</h2><p>Big rooms feel smaller when you have someone to explore with.</p><button className="text-button" onClick={() => setModal({ kind: 'profile' })}>Tune your discovery <Icon name="settings" size={15} /></button></section>
          <section className="interest-panel"><div className="section-heading"><h3>Following your curiosity</h3><button className="icon-button" aria-label="Edit your interests" onClick={() => setModal({ kind: 'profile' })}><Icon name="settings" size={15} /></button></div><div className="tags">{profile.asks.split(',').filter((tag) => tag.trim()).map((tag, index) => <span key={`${index}-${tag}`}>{tag.trim()}</span>)}</div><p className="fine">Your saves help shape what comes next.</p></section>
          <section className="day-plan"><div className="section-heading"><h3>A little plan for today</h3><Icon name="clock" size={17} /></div><div className="timeline-item"><span className="timeline-dot" /><div><span className="eyebrow">12:30 PM — 2:30 PM ET</span><strong>Follow an interesting poster</strong><small>Illustrative session · Exhibit Hall E</small></div></div>{joined.length ? joined.map((group) => <div className="timeline-item" key={group.id}><span className="timeline-dot coral" /><div><span className="eyebrow">{group.time} ET · JOINED</span><strong>{group.subtitle}</strong><small>{group.place}</small></div></div>) : <div className="timeline-item"><span className="timeline-dot hollow" /><div><strong>Leave room for a hello</strong><small>Join a small meetup to add it here.</small></div></div>}<span className="fine">Fixed replay clock · not today's live program</span></section>
          <div className="quote-note"><span>“</span><p>The best part of a conference<br />isn't always on the schedule.</p><svg viewBox="0 0 130 30" aria-hidden="true"><path d="M4 13c32 17 70-16 95 0s-1 16-15 5 30-7 39-2" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></div>
          <p className="local-note"><Icon name="check" size={14} /> Browser-local prototype · <span id="app-version">version {__APP_VERSION__}</span></p>
        </aside>
      </div>
    </div>
    <div className="toast-region" role="status" aria-live="polite">{notice && <div className="toast"><Icon name="check" size={18} />{notice}</div>}</div>
    {modal?.kind === 'profile' && <Modal title="Make this conference yours." onClose={() => setModal(null)} wide><ProfileForm key={actor} profile={profile} onSave={(values) => { if (commit({ ...state, profiles: { ...state.profiles, [actor]: values } })) { setModal(null); setNotice('Discovery updated. Your interests and preferences are saved.'); } }} /></Modal>}
    {(modal?.kind === 'detail' || modal?.kind === 'match') && <Modal title={modal.kind === 'match' && modalMatched ? 'A little mutual curiosity.' : modal.card.title} onClose={() => setModal(null)}>{modal.kind === 'match' && modalMatched && <div className="match-celebration"><Avatar person={identity} /><span><Icon name="bulb" size={26} /></span><Avatar person={modal.card} /><p>You and {modal.card.title.split(' ')[0]} both chose to connect.</p></div>}{detailBody(modal.card)}</Modal>}
    {modal?.kind === 'requests' && <Modal title="Chat requests" onClose={() => setModal(null)}>{requests.length === 0 ? <p className="muted">No new requests. When someone taps Interested on you, it shows up here.</p> : requests.map((card) => <div className="request-row" key={card.id}><Avatar person={card} small /><div><strong>{card.title}</strong><small>{card.stage} · offers {card.offers.toLowerCase()}</small>{conversation(state, actor, card.id)[0]?.from === card.id && <p className="request-note">“{conversation(state, actor, card.id)[0].body}”</p>}</div><div className="request-actions"><button className="button pass-button" onClick={() => answer(card, 'rejected')}>Decline</button><button className="button primary" onClick={() => answer(card, 'accepted')}>Accept</button></div></div>)}<p className="fine">Declining is private: the sender only sees that the request wasn't accepted.</p></Modal>}
    {modal?.kind === 'chat' && <Modal title={<><Icon name="bulb" size={24} className="title-icon" /> Chat with {modal.card.title.split(' ')[0]}</>} onClose={() => setModal(null)}>{isMatched(state, actor, modal.card.id) ? <ChatWindow key={`${actor}-${modal.card.id}`} me={actor} other={modal.card} thread={conversation(state, actor, modal.card.id)} draft={introFor(state, actor, modal.card)} onSend={(text) => send(modal.card, text)} /> : <p className="muted">This chat isn't open. It opens once a request is accepted.</p>}</Modal>}
    {modal?.kind === 'reset' && <Modal title="A fresh start?" onClose={() => setModal(null)}><p className="muted">This clears every demo identity's saved items, passes, requests, chats, and introductions in this browser. Nothing on a server is changed.</p><button className="button primary full" onClick={() => {
      try { localStorage.removeItem(STORAGE_KEY); setState(freshState()); setError(''); setLastAction(null); setPaperId(null); setModal(null); setView('discover'); setNotice('Local demo reset. A fresh set of possibilities.'); }
      catch (failure) { setError(`Cannot reset browser storage: ${failure.message}`); }
    }}>Reset local demo</button></Modal>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
