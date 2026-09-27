export const EVENT_TYPES = ['Decision', 'Experiment', 'Discovery', 'Milestone', 'Pause', 'Review', 'Small change'] as const;
export const EVENT_STATUSES = ['Planned', 'Ongoing', 'Recorded', 'Superseded', 'Archived'] as const;
export const SIGNALS = ['Not assessed', 'Supports', 'Challenges', 'Mixed'] as const;
export type Link = { label: string; url: string };
export type Meta = { _id: string; revision: number };
export type JourneyEvent = Meta & {
  title: string; chapter: string; type: typeof EVENT_TYPES[number]; status: typeof EVENT_STATUSES[number];
  order: number; date: string | null; happened: string; significance: string; changed: string;
  beliefBefore: string; alternatives: string; expectation: string; successCriteria: string;
  result: string; learning: string; nextStep: string; evidence: string; signal: typeof SIGNALS[number];
  parentIds: string[]; links: Link[]; source: string;
  updates: { id: string; text: string; date: string | null }[];
};
export type Playbook = Meta & {
  title: string; status: 'Draft' | 'In use' | 'Retired'; purpose: string; whenToUse: string;
  prerequisites: string; steps: string; expectedOutput: string; pitfalls: string;
  assumptions: string; changeNotes: string; sourceEventIds: string[]; links: Link[];
};
export type Overview = Meta & { purpose: string; focus: string; customer: string; problem: string; offer: string; openQuestions: string; nextTest: string };
export type Journey = { events: JourneyEvent[]; playbooks: Playbook[]; overview: Overview | null; initialized: boolean };
export type Editor = { kind: 'event'; value: JourneyEvent } | { kind: 'playbook'; value: Playbook } | { kind: 'overview'; value: Overview };

export function blankEvent(order: number, type: JourneyEvent['type'] = 'Decision'): JourneyEvent {
  return { _id: '', revision: 0, title: '', chapter: '', type, status: type === 'Experiment' ? 'Planned' : 'Recorded', order, date: null,
    happened: '', significance: '', changed: '', beliefBefore: '', alternatives: '', expectation: '', successCriteria: '',
    result: '', learning: '', nextStep: '', evidence: '', signal: 'Not assessed', parentIds: [], links: [], source: '', updates: [] };
}
export function blankPlaybook(event?: JourneyEvent): Playbook {
  return { _id: '', revision: 0, title: event ? `Lessons from ${event.title}` : '', status: 'Draft', purpose: event?.learning || '',
    whenToUse: '', prerequisites: '', steps: '', expectedOutput: '', pitfalls: '', assumptions: '', changeNotes: '',
    sourceEventIds: event ? [event._id] : [], links: [] };
}
export function withoutMeta<T extends Meta>({ _id, revision, ...data }: T) { void _id; void revision; return data; }
export function orderedEvents(events: JourneyEvent[]) { return [...events].sort((a, b) => a.order - b.order || a._id.localeCompare(b._id)); }
export function download(name: string, data: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
