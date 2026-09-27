export const STATUSES = ['IDEA', 'RESEARCHING', 'READY TO SCRIPT', 'READY TO FILM', 'FILMED', 'EDITING', 'READY', 'SCHEDULED', 'PUBLISHED', 'REVIEWED', 'REPURPOSE', 'ARCHIVED'] as const;
export const PLATFORMS = ['TikTok', 'Instagram Reels', 'YouTube Shorts'] as const;
export const METRICS = {
  views: 'Views', reach: 'Reach', watchTimeSeconds: 'Watch time (seconds)', averagePercentageViewed: 'Average viewed (%)', completionRate: 'Completion (%)', rewatches: 'Rewatches', likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves', profileVisits: 'Profile visits', followersGained: 'Followers gained', returningViewers: 'Returning viewers', websiteVisits: 'Website visits', waitlistConversions: 'Waitlist conversions', leads: 'Qualified leads', founderConversations: 'Founder conversations', serviceRequests: 'Trial / service requests', customers: 'Customers', attributedRevenue: 'Attributed revenue',
} as const;
export type Identity = 'enzo' | 'hustliq';
export type MetricKey = keyof typeof METRICS;
export type Publication = { platform: typeof PLATFORMS[number]; status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED'; url: string; date: string | null; measuredAt: string | null; metrics: Record<MetricKey, number | null>; notes: string };
export type Asset = {
  _id: string; revision: number; identity: Identity; title: string; territory: string; format: string;
  status: typeof STATUSES[number]; priority: 'Normal' | 'High' | 'Low'; timing: 'Unclassified' | 'Evergreen' | 'Timely';
  source: string; experiment: string; research: string; assets: string; evidence: string; privacy: string;
  hooks: string; script: string; editorBrief: string; notes: string; followUp: string; series: string; relatedIds: string[];
  filmingDate: string | null; scheduledDate: string | null; editorStatus: string; productionMinutes: number | null; publications: Publication[];
};
export type Settings = { _id: string; revision: number; startDate: string | null; enzoWeekly: number; hustliqWeekly: number; dailyMinutes: number; firstRecordingMinutes: number; firstRecordingDate: string | null; editorAvailableUntil: string | null; editorTurnaroundDays: number; backlogTarget: number; notes: string };
export function blankAsset(identity: Identity): Asset {
  return { _id: '', revision: 0, identity, title: '', territory: '', format: '', status: 'IDEA', priority: 'Normal', timing: 'Unclassified', source: '', experiment: '', research: '', assets: '', evidence: '', privacy: 'Needs review', hooks: '', script: '', editorBrief: '', notes: '', followUp: '', series: '', relatedIds: [], filmingDate: null, scheduledDate: null, editorStatus: 'Not assigned', productionMinutes: null, publications: PLATFORMS.map(platform => ({ platform, status: 'DRAFT', url: '', date: null, measuredAt: null, metrics: Object.fromEntries(Object.keys(METRICS).map(key => [key, null])) as Publication['metrics'], notes: '' })) };
}
export function cairoToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function addDays(date: string, days: number) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function monday(date: string) { return addDays(date, -((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7)); }
export function publishedInWeek(asset: Asset, start: string) { return asset.publications.some(p => p.status === 'PUBLISHED' && p.date && p.date >= start && p.date < addDays(start, 7)); }
export function withoutMeta<T extends { _id: string; revision: number }>(record: T) { const { _id, revision, ...data } = record; return data; }
