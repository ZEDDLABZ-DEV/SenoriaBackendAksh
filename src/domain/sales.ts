export const LEAD_STAGES = ["New", "Contacted", "Qualified", "Visit booked", "Won", "Lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const CLOSED_LEAD_STAGES: LeadStage[] = ["Won", "Lost"];

export const LEAD_SOURCES = ["Facebook", "Instagram", "Phone", "Referral"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const QUEUE_FILTERS = ["new", "due", "overdue", "mine"] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export const NOTE_OUTCOMES = ["Connected", "No answer", "Voicemail", "Booked"] as const;
export type NoteOutcome = (typeof NOTE_OUTCOMES)[number];

export const TIMELINE_KINDS = ["Lead", "Call", "Note", "Meeting", "Stage", "Assignment"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export const CALL_DIRECTIONS = ["Outbound", "Inbound"] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_RESULTS = ["Connected", "No answer", "Voicemail", "Missed"] as const;
export type CallResult = (typeof CALL_RESULTS)[number];

export const MEETING_KINDS = ["Call", "Visit"] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];
