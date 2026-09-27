"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import './journey/journey.css';
import { EVENT_TYPES, EVENT_STATUSES, SIGNALS, blankEvent, blankPlaybook, orderedEvents, withoutMeta, download,
  type Editor, type Journey, type JourneyEvent, type Link, type Overview, type Playbook } from './journey/types';

const tabs = ['Big picture', 'Events', 'Playbooks', 'Direction review'] as const;
const signalLabels = { 'Not assessed': 'Not assessed yet', Supports: 'Supports the tested assumption', Challenges: 'Challenges the tested assumption', Mixed: 'Mixed evidence for the tested assumption' };
const overviewFields = [
  ['purpose', 'Why I’m building this'], ['focus', 'The current focus'], ['customer', 'Who we’re helping'],
  ['problem', 'The problem we’re addressing'], ['offer', 'The current offer'],
  ['openQuestions', 'What we still need to learn'], ['nextTest', 'The next thing to test'],
] as const;
const playbookFields = [
  ['purpose', 'What this helps us do'], ['whenToUse', 'When to use it'], ['prerequisites', 'What to prepare'],
  ['steps', 'Steps to follow'], ['expectedOutput', 'What done looks like'], ['pitfalls', 'Mistakes to avoid'],
  ['assumptions', 'Assumptions and limitations'], ['changeNotes', 'What changed and why'],
] as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="jw-field"><span>{label}</span>{children}</label>;
}
function Note({ label, text, placeholder }: { label: string; text: string; placeholder?: string }) {
  if (!text && !placeholder) return null;
  return <section className="jw-note"><h3>{label}</h3><p className={!text ? 'jw-muted' : ''}>{text || placeholder}</p></section>;
}
function EvidenceLinks({ links }: { links: Link[] }) {
  return links.length ? <section className="jw-note"><h3>Evidence & documents</h3><ul>{links.map((l, i) => <li key={i}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a></li>)}</ul></section> : null;
}
function LinkEditor({ links, onChange }: { links: Link[]; onChange: (value: Link[]) => void }) {
  return <div><p className="jw-muted">Link to research, screenshots, documents, or conversations.</p>{links.map((link, index) => <div className="jw-link-row" key={index}>
    <Field label={`Link ${index + 1} name`}><input required maxLength={300} value={link.label} onChange={e => onChange(links.map((l, i) => i === index ? { ...l, label: e.target.value } : l))} /></Field>
    <Field label={`Link ${index + 1} URL`}><input type="url" required pattern="https?://.*" maxLength={2048} value={link.url} onChange={e => onChange(links.map((l, i) => i === index ? { ...l, url: e.target.value } : l))} /></Field>
    <button type="button" aria-label={`Remove link ${index + 1}`} onClick={() => onChange(links.filter((_, i) => i !== index))}>Remove</button>
  </div>)}<button type="button" disabled={links.length >= 30} onClick={() => onChange([...links, { label: '', url: '' }])}>+ Add evidence link</button></div>;
}

export default function JourneyWorkspace({ apiBase }: { apiBase: string }) {
  const [data, setData] = useState<Journey | null>(null);
  const [tab, setTab] = useState<typeof tabs[number]>('Big picture');
  const [selection, setSelection] = useState<{ kind: 'event' | 'playbook'; id: string } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [original, setOriginal] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [updateText, setUpdateText] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('All types');
  const [chapter, setChapter] = useState('All chapters');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const errorFeedback = useRef<HTMLDivElement>(null);
  const discardFeedback = useRef<HTMLDivElement>(null);
  const dirty = !!editor && (JSON.stringify(editor) !== original || !!updateText.trim());

  const api = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${apiBase}/api/journey${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || (response.status === 404 ? 'Journey storage is not available on this server yet.' : 'Could not reach journey storage. Please try again.'));
    return result;
  }, [apiBase]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      let result: Journey = await api('');
      if (!result.initialized) { await api('/initialize', 'POST', {}); result = await api(''); }
      setData(result);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load your journey.'); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (editor) dialog.current?.showModal(); else dialog.current?.close(); }, [!!editor]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);
  useEffect(() => { if (selection) detailHeading.current?.focus(); }, [selection]);
  useEffect(() => { if (saveError) errorFeedback.current?.focus(); }, [saveError]);
  useEffect(() => { if (confirmClose) discardFeedback.current?.focus(); }, [confirmClose]);

  function edit(value: Editor) { setEditor(structuredClone(value)); setOriginal(JSON.stringify(value)); setUpdateText(''); setSaveError(''); setConfirmClose(false); }
  function closeEditor() { if (saving) return; if (dirty) setConfirmClose(true); else setEditor(null); }
  function patch(value: Partial<JourneyEvent> | Partial<Playbook> | Partial<Overview>) {
    setEditor(current => current ? { ...current, value: { ...current.value, ...value } } as Editor : null);
  }
  const events = orderedEvents(data?.events || []);
  const active = events.filter(e => e.status !== 'Archived');
  const story = active.filter(e => e.type !== 'Small change');
  const nextOrder = Math.max(0, ...events.map(e => e.order)) + 10;
  function newEvent(type: JourneyEvent['type'] = 'Decision', parent?: JourneyEvent) {
    const value = blankEvent(nextOrder, type);
    if (parent) { value.parentIds = [parent._id]; value.chapter = parent.chapter; }
    edit({ kind: 'event', value });
  }
  async function save(e: FormEvent) {
    e.preventDefault(); if (!editor || saving) return;
    const value = structuredClone(editor.value);
    if (editor.kind === 'event' && updateText.trim()) (value as JourneyEvent).updates.push({ id: crypto.randomUUID(), text: updateText.trim(), date: null });
    setSaving(true); setSaveError('');
    const path = editor.kind === 'overview' ? '/overview' : `/${editor.kind === 'event' ? 'events' : 'playbooks'}${value._id ? `/${encodeURIComponent(value._id)}` : ''}`;
    try {
      const result = await api(path, value._id ? 'PUT' : 'POST', value._id ? { revision: value.revision, data: withoutMeta(value) } : withoutMeta(value));
      setData(current => {
        if (!current) return current;
        if (editor.kind === 'overview') return { ...current, overview: result };
        const key = editor.kind === 'event' ? 'events' : 'playbooks';
        return { ...current, [key]: value._id ? current[key].map(item => item._id === result._id ? result : item) : [...current[key], result] };
      });
      if (editor.kind !== 'overview') setSelection({ kind: editor.kind, id: result._id });
      setEditor(null); setNotice('Saved to your journey.');
    } catch (e) { setSaveError(e instanceof Error ? e.message : 'Save failed. Your draft is still here.'); }
    finally { setSaving(false); }
  }
  function eventButton(event: JourneyEvent, compact = false) {
    return <button key={event._id} className={`jw-event ${compact ? 'jw-event-compact' : ''}`} onClick={() => setSelection({ kind: 'event', id: event._id })}>
      <span className="jw-meta">{event.type} · {event.status}{event.chapter ? ` · ${event.chapter}` : ''}</span>
      <strong>{event.title}</strong>{!compact && <span>{event.changed || event.happened || 'Open to add the story.'}</span>}
      {event.signal !== 'Not assessed' && <span className={`jw-signal jw-${event.signal.toLowerCase()}`}>{signalLabels[event.signal]}</span>}
    </button>;
  }
  function eventPicker(label: string, selected: string[], onChange: (ids: string[]) => void, exclude = '') {
    return <fieldset className="jw-picker"><legend>{label}</legend>{events.filter(e => e._id !== exclude).map(event => <label key={event._id}>
      <input type="checkbox" checked={selected.includes(event._id)} onChange={e => onChange(e.target.checked ? [...selected, event._id] : selected.filter(id => id !== event._id))} />
      <span>{event.title}{event.status === 'Archived' ? ' (archived)' : ''}</span>
    </label>)}{!events.length && <p className="jw-muted">Add an event first to connect it here.</p>}</fieldset>;
  }

  const selectedEvent = selection?.kind === 'event' ? events.find(e => e._id === selection.id) : null;
  const selectedPlaybook = selection?.kind === 'playbook' ? data?.playbooks.find(p => p._id === selection.id) : null;
  const overview = data?.overview;
  const visible = events.filter(e => (showArchived || e.status !== 'Archived') && (type === 'All types' || e.type === type) &&
    (chapter === 'All chapters' || e.chapter === chapter) && [e.title, e.happened, e.changed, e.learning, e.evidence, e.source, e.updates.map(u => u.text).join(' ')].join(' ').toLowerCase().includes(search.toLowerCase()));

  return <section className="journey-workspace">
    <div className="jw-heading"><div><p className="eyebrow">HustlIQ · The founder’s record</p><h1>HustlIQ Journey</h1><p>Remember the reasons. See what changed. Decide what comes next.</p></div>
      <div className="jw-actions"><button disabled={!data || loading} onClick={() => download('hustliq-journey.json', JSON.stringify(data, null, 2))}>Export journey</button><button className="jw-primary" disabled={!data || loading} onClick={() => newEvent()}>+ Record an event</button></div>
    </div>
    {error && <div role="alert" className="jw-error">{error}<button disabled={loading} onClick={() => void load()}>Retry loading</button></div>}
    {notice && <div role="status" className="jw-notice">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
    <div className="jw-tabs" role="group" aria-label="Journey views">{tabs.map(name => <button key={name} aria-pressed={tab === name} className={tab === name ? 'active' : ''} onClick={() => { setTab(name); setSelection(null); }}>{name}</button>)}<button className="jw-refresh" disabled={loading} onClick={() => void load()}>Refresh</button></div>
    {!data ? <p className="jw-empty" role="status">{loading ? 'Opening your journey…' : 'Your journey could not be loaded. Retry when storage is available.'}</p> : <>
      {selection && <button className="jw-back" onClick={() => setSelection(null)}>← Back to {tab.toLowerCase()}</button>}
      {selectedEvent ? <article className="jw-panel jw-detail">
        <div className="jw-section-head"><div><p className="jw-meta">{selectedEvent.type} · {selectedEvent.status} · {selectedEvent.date || 'Event date not recorded'}</p><h2 ref={detailHeading} tabIndex={-1}>{selectedEvent.title}</h2><p className="jw-muted">{selectedEvent.chapter}</p></div><button onClick={() => edit({ kind: 'event', value: selectedEvent })}>Edit event</button></div>
        <Note label="What happened" text={selectedEvent.happened} placeholder="The story has not been written yet." />
        <Note label="Why it mattered" text={selectedEvent.significance} /><Note label="What changed" text={selectedEvent.changed} />
        <div className="jw-columns"><div><Note label="What I believed beforehand" text={selectedEvent.beliefBefore} /><Note label="Alternatives considered" text={selectedEvent.alternatives} /><Note label="What I expected" text={selectedEvent.expectation} /><Note label="What would count as a useful result" text={selectedEvent.successCriteria} /></div>
          <div><Note label="What actually happened" text={selectedEvent.result} /><Note label="Evidence and limitations" text={selectedEvent.evidence} /><Note label="What I learned" text={selectedEvent.learning} /><Note label="The next step" text={selectedEvent.nextStep} /></div></div>
        <p className="jw-muted">Evidence assessment: {signalLabels[selectedEvent.signal]}</p>
        <EvidenceLinks links={selectedEvent.links} />
        {selectedEvent.updates.length > 0 && <section className="jw-note"><h3>Updates within this event</h3><ol className="jw-updates">{selectedEvent.updates.map(update => <li key={update.id}><p>{update.text}</p>{update.date && <small>{update.date}</small>}</li>)}</ol></section>}
        <div className="jw-columns">
          <section><h3>Prompted by</h3>{selectedEvent.parentIds.length ? events.filter(e => selectedEvent.parentIds.includes(e._id)).map(e => eventButton(e, true)) : <p className="jw-muted">No preceding event linked.</p>}</section>
          <section><h3>Led to</h3>{events.some(e => e.parentIds.includes(selectedEvent._id)) ? events.filter(e => e.parentIds.includes(selectedEvent._id)).map(e => eventButton(e, true)) : <p className="jw-muted">The next event has not been linked yet.</p>}</section>
        </div>
        {data.playbooks.some(p => p.sourceEventIds.includes(selectedEvent._id)) && <section className="jw-note"><h3>Connected playbooks</h3>{data.playbooks.filter(p => p.sourceEventIds.includes(selectedEvent._id)).map(p => <button className="jw-inline-link" key={p._id} onClick={() => setSelection({ kind: 'playbook', id: p._id })}>{p.title} · {p.status} →</button>)}</section>}
        <Note label="Source of this record" text={selectedEvent.source} />
        <div className="jw-actions"><button onClick={() => newEvent('Decision', selectedEvent)}>+ Record what this led to</button><button onClick={() => edit({ kind: 'playbook', value: blankPlaybook(selectedEvent) })}>Build a playbook from this</button></div>
      </article> : selectedPlaybook ? <article className="jw-panel jw-detail">
        <div className="jw-section-head"><div><p className="jw-meta">Playbook · {selectedPlaybook.status}</p><h2 ref={detailHeading} tabIndex={-1}>{selectedPlaybook.title}</h2></div><button onClick={() => edit({ kind: 'playbook', value: selectedPlaybook })}>Edit playbook</button></div>
        {selectedPlaybook.status === 'Draft' && <p className="jw-callout">Draft procedure. Review and adapt it before treating it as an established way of working.</p>}
        {playbookFields.map(([key, label]) => <Note key={key} label={label} text={selectedPlaybook[key]} placeholder={key === 'steps' ? 'Add the steps as you develop this procedure.' : undefined} />)}
        <EvidenceLinks links={selectedPlaybook.links} />
        <section className="jw-note"><h3>Events behind this playbook</h3>{selectedPlaybook.sourceEventIds.length ? events.filter(e => selectedPlaybook.sourceEventIds.includes(e._id)).map(e => eventButton(e, true)) : <p className="jw-muted">No source events linked yet.</p>}</section>
      </article> : !selection && <>
        {tab === 'Big picture' && <>
          <section className="jw-focus"><p className="eyebrow">Where things stand</p><h2>{overview?.focus || 'Add the direction you’re exploring.'}</h2><p>{overview?.purpose || 'Your reason for building HustlIQ belongs here. Add it in the current picture.'}</p><button onClick={() => overview && edit({ kind: 'overview', value: overview })}>Edit the current picture</button></section>
          <div className="jw-section-head"><div><h2>The story so far</h2><p className="jw-muted">Turning points in your chosen story order. Open an event to follow its connections.</p></div><button onClick={() => { setTab('Events'); setSelection(null); }}>All events →</button></div>
          <div className="jw-story">{story.length ? story.map((event, index) => <div className="jw-story-step" key={event._id}><span className="jw-step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{eventButton(event)}</div>) : <p className="jw-empty">Record a decision, experiment, or discovery to start your story.</p>}</div>
          <div className="jw-columns jw-spaced"><section className="jw-panel"><h2>The current picture</h2>{overviewFields.filter(([key]) => ['customer', 'problem', 'offer'].includes(key)).map(([key, label]) => <Note key={key} label={label} text={overview?.[key] || ''} placeholder="Not documented yet." />)}</section>
            <section className="jw-panel"><h2>What comes next</h2><Note label="Open questions" text={overview?.openQuestions || ''} placeholder="Add what you still need to learn." /><Note label="Next test" text={overview?.nextTest || ''} placeholder="No next test recorded." /><button onClick={() => newEvent('Experiment')}>+ Start an experiment record</button></section></div>
          <section className="jw-panel jw-spaced"><h2>Lessons worth remembering</h2><p className="jw-muted">Lessons you’ve recorded in the work, ready to revisit when you need perspective.</p>{active.some(e => e.learning.trim()) ? active.filter(e => e.learning.trim()).map(e => <div className="jw-lesson" key={e._id}><p>{e.learning}</p><button onClick={() => setSelection({ kind: 'event', id: e._id })}>{e.title} →</button></div>) : <p className="jw-empty">Your early turning points are recorded. Add lessons as the experiments unfold.</p>}</section>
        </>}
        {tab === 'Events' && <>
          <div className="jw-toolbar"><Field label="Search events"><input type="search" placeholder="A decision, lesson, or piece of evidence…" value={search} onChange={e => setSearch(e.target.value)} /></Field>
            <Field label="Event type"><select value={type} onChange={e => setType(e.target.value)}>{['All types', ...EVENT_TYPES].map(t => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Chapter"><select value={chapter} onChange={e => setChapter(e.target.value)}>{['All chapters', ...new Set(events.map(e => e.chapter).filter(Boolean))].map(c => <option key={c}>{c}</option>)}</select></Field></div>
          <label className="jw-check"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Include archived events</label>
          <p className="jw-muted">{visible.length} {visible.length === 1 ? 'event' : 'events'} · Small changes can also be added as updates inside an existing event.</p>
          <div className="jw-event-grid">{visible.map(e => eventButton(e))}</div>{!visible.length && <p className="jw-empty">No events match these filters.</p>}
        </>}
        {tab === 'Playbooks' && <>
          <div className="jw-section-head"><div><h2>How we work</h2><p className="jw-muted">Reusable procedures, with their reasoning and source events attached.</p></div><button className="jw-primary" onClick={() => edit({ kind: 'playbook', value: blankPlaybook() })}>+ New playbook</button></div>
          <div className="jw-event-grid">{data.playbooks.map(p => <button className="jw-event" key={p._id} onClick={() => setSelection({ kind: 'playbook', id: p._id })}><span className="jw-meta">{p.status} · {p.sourceEventIds.length} source {p.sourceEventIds.length === 1 ? 'event' : 'events'}</span><strong>{p.title}</strong><span>{p.purpose || 'Add a purpose and steps.'}</span></button>)}</div>{!data.playbooks.length && <p className="jw-empty">Turn a lesson into a procedure, or create a playbook from scratch.</p>}
        </>}
        {tab === 'Direction review' && <>
          <section className="jw-focus"><p className="eyebrow">A decision when you’re ready</p><h2>What has the work taught you?</h2><p>Review the evidence, your reasons, and your capacity. Record your decision and what would make you reconsider.</p><button className="jw-primary" onClick={() => newEvent('Review')}>Record a direction review</button></section>
          <div className="jw-columns">{(['Supports', 'Challenges', 'Mixed', 'Not assessed'] as const).map(signal => <section className="jw-panel" key={signal}><h2>{signal === 'Supports' ? 'Supporting evidence' : signal === 'Challenges' ? 'Challenging evidence' : signal === 'Mixed' ? 'Mixed results' : 'Still unassessed'}</h2><p className="jw-muted">{signal === 'Not assessed' ? 'Events whose implications have not been assessed.' : 'Your assessment of the assumption tested in each event.'}</p>{active.filter(e => e.signal === signal).map(e => eventButton(e, true))}{!active.some(e => e.signal === signal) && <p className="jw-empty">No events in this group yet.</p>}</section>)}</div>
          <div className="jw-columns jw-spaced"><section className="jw-panel"><h2>Experiments still open</h2>{active.filter(e => e.type === 'Experiment' && ['Planned', 'Ongoing'].includes(e.status)).map(e => eventButton(e, true))}{!active.some(e => e.type === 'Experiment' && ['Planned', 'Ongoing'].includes(e.status)) && <p className="jw-muted">No open experiments recorded.</p>}</section><section className="jw-panel"><h2>Previous direction reviews</h2>{active.filter(e => e.type === 'Review').map(e => eventButton(e, true))}{!active.some(e => e.type === 'Review') && <p className="jw-muted">Your first review will appear here.</p>}</section></div>
        </>}
      </>}
      {selection && !selectedEvent && !selectedPlaybook && <p className="jw-empty">This entry is no longer available. Return to the overview or refresh.</p>}
    </>}

    <dialog className="jw-dialog" ref={dialog} aria-labelledby="jw-editor-title" onCancel={e => { e.preventDefault(); closeEditor(); }}>
      {editor && <form onSubmit={save}>
        <div className="jw-dialog-head"><div><p className="jw-meta">{editor.kind === 'overview' ? 'A living summary' : editor.value._id ? 'Update your record' : 'Start with what you know'}</p><h2 id="jw-editor-title">{editor.kind === 'overview' ? 'The current picture' : `${editor.value._id ? 'Edit' : 'New'} ${editor.kind}`}</h2></div><button type="button" disabled={saving} aria-label="Close editor" onClick={closeEditor}>×</button></div>
        <fieldset className="jw-dialog-body" disabled={saving}>
          {editor.kind === 'overview' ? overviewFields.map(([key, label]) => <Field key={key} label={label}><textarea rows={key === 'focus' ? 2 : 3} maxLength={20000} value={editor.value[key]} onChange={e => patch({ [key]: e.target.value })} /></Field>) : <>
            <Field label="Title"><input autoFocus required maxLength={300} value={editor.value.title} onChange={e => patch({ title: e.target.value })} /></Field>
            {editor.kind === 'event' ? <>
              <div className="jw-columns"><Field label="Event type"><select value={editor.value.type} onChange={e => patch({ type: e.target.value as JourneyEvent['type'] })}>{EVENT_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field><Field label="Status"><select value={editor.value.status} onChange={e => patch({ status: e.target.value as JourneyEvent['status'] })}>{EVENT_STATUSES.map(s => <option key={s}>{s}</option>)}</select></Field></div>
              <Field label="What happened?"><textarea rows={4} maxLength={20000} placeholder="Rough notes are fine. Start with the actual event." value={editor.value.happened} onChange={e => patch({ happened: e.target.value })} /></Field>
              <Field label="Why did it matter?"><textarea rows={2} maxLength={20000} value={editor.value.significance} onChange={e => patch({ significance: e.target.value })} /></Field>
              <Field label="What changed because of it?"><textarea rows={2} maxLength={20000} value={editor.value.changed} onChange={e => patch({ changed: e.target.value })} /></Field>
              <details><summary>Expectations & alternatives</summary>{([['beliefBefore', 'What I believed beforehand'], ['alternatives', 'Alternatives I considered'], ['expectation', 'What I expected to happen'], ['successCriteria', 'What would support or challenge this assumption?']] as const).map(([key, label]) => <Field key={key} label={label}><textarea rows={3} maxLength={20000} value={editor.value[key]} onChange={e => patch({ [key]: e.target.value })} /></Field>)}</details>
              <details><summary>Results, evidence & lessons</summary>{([['result', 'What actually happened'], ['evidence', 'Evidence and limitations'], ['learning', 'What I learned'], ['nextStep', 'The next step']] as const).map(([key, label]) => <Field key={key} label={label}><textarea rows={3} maxLength={20000} value={editor.value[key]} onChange={e => patch({ [key]: e.target.value })} /></Field>)}
                <Field label="How does this affect the tested assumption?"><select value={editor.value.signal} onChange={e => patch({ signal: e.target.value as JourneyEvent['signal'] })}>{SIGNALS.map(s => <option key={s}>{s}</option>)}</select></Field><LinkEditor links={editor.value.links} onChange={links => patch({ links })} /></details>
              <details><summary>Connections & story position</summary><Field label="Chapter"><input list="jw-chapters" maxLength={120} placeholder="e.g. Distribution focus" value={editor.value.chapter} onChange={e => patch({ chapter: e.target.value })} /><datalist id="jw-chapters">{[...new Set(events.map(e => e.chapter).filter(Boolean))].map(c => <option key={c} value={c} />)}</datalist></Field>
                <div className="jw-columns"><Field label="Story position (lower comes first)"><input type="number" required min={0} max={1000000} step={1} value={editor.value.order} onChange={e => patch({ order: Number(e.target.value) })} /></Field><Field label="Event date (optional)"><input type="date" value={editor.value.date || ''} onChange={e => patch({ date: e.target.value || null })} /></Field></div>
                {eventPicker('Which events prompted this?', editor.value.parentIds, parentIds => patch({ parentIds }), editor.value._id)}<Field label="Source or original notes"><textarea rows={3} maxLength={20000} value={editor.value.source} onChange={e => patch({ source: e.target.value })} /></Field></details>
              <details open={!!editor.value._id}><summary>Updates within this event</summary>{editor.value.updates.map((update, index) => <Field key={update.id} label={`Update ${index + 1}`}><textarea required rows={2} maxLength={20000} value={update.text} onChange={e => { if (editor.kind === 'event') patch({ updates: editor.value.updates.map(u => u.id === update.id ? { ...u, text: e.target.value } : u) }); }} /></Field>)}
                <Field label="Add an update"><textarea rows={3} maxLength={20000} placeholder="A small change, new finding, or follow-up. It stays inside this event." value={updateText} onChange={e => setUpdateText(e.target.value)} /></Field></details>
            </> : <>
              <Field label="Procedure status"><select value={editor.value.status} onChange={e => patch({ status: e.target.value as Playbook['status'] })}>{['Draft', 'In use', 'Retired'].map(s => <option key={s}>{s}</option>)}</select></Field>
              {playbookFields.map(([key, label]) => <Field key={key} label={label}><textarea rows={key === 'steps' ? 9 : 3} maxLength={20000} value={editor.value[key]} onChange={e => patch({ [key]: e.target.value })} /></Field>)}
              {eventPicker('Events that informed this procedure', editor.value.sourceEventIds, sourceEventIds => patch({ sourceEventIds }))}
              <LinkEditor links={editor.value.links} onChange={links => patch({ links })} />
            </>}
          </>}
        </fieldset>
        {saveError && <div role="alert" tabIndex={-1} ref={errorFeedback} className="jw-error">{saveError} Your draft is still open.</div>}
        {confirmClose && <div className="jw-discard" tabIndex={-1} ref={discardFeedback} role="alert"><p>Discard the changes in this draft?</p><button type="button" onClick={() => setConfirmClose(false)}>Keep editing</button><button type="button" onClick={() => setEditor(null)}>Discard draft</button></div>}
        <div className="jw-dialog-footer"><button type="button" disabled={saving} onClick={() => download('hustliq-draft.json', JSON.stringify({ ...editor, pendingUpdate: updateText }, null, 2))}>Download draft</button><button type="button" disabled={saving} onClick={closeEditor}>Cancel</button><button className="jw-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
      </form>}
    </dialog>
  </section>;
}
