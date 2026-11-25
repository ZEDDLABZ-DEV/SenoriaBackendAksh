import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";
import { resetClock, setClock } from "../src/lib/clock";
import { addDays, parseIsoDate } from "../src/lib/dates";
import { calendarDateInTimeZone, dayBounds, zonedDateTimeToUtc } from "../src/lib/timezone";
import { createCall, listCalls } from "../src/services/calls.service";
import {
  addLeadNote,
  assignmentState,
  changeLeadStage,
  createLead,
  listLeads,
  requestDayWindow,
  type SalesActor,
} from "../src/services/leads.service";
import { createMeeting, listMeetings } from "../src/services/meetings.service";
import { listSalespeople } from "../src/services/salespeople.service";
import type { LeadSource, LeadStage } from "../src/domain/sales";

const TIME_ZONE = "America/Vancouver";
const PASSWORD = "SeedSales1!";
const UNMATCHED_PHONE = "437-555-0198";

const PREVIOUS_SEED_EMAILS = [
  "alex.morgan@example.com",
  "priya.nair@example.com",
  "sam.seller@example.com",
  "ira.inactive@example.com",
];

const SALES_USERS = [
  { key: "alex", email: "alex.morgan@senoria.seed", firstName: "Alex", lastName: "Morgan", status: "active", phone: "416-555-0101", dateOfBirth: "1990-04-12" },
  { key: "priya", email: "priya.nair@senoria.seed", firstName: "Priya", lastName: "Nair", status: "active", phone: "416-555-0108", dateOfBirth: "1992-08-21" },
  { key: "sam", email: "sam.ortiz@senoria.seed", firstName: "Sam", lastName: "Ortiz", status: "active", phone: "647-555-0114", dateOfBirth: "1988-01-30" },
  { key: "lena", email: "lena.brooks@senoria.seed", firstName: "Lena", lastName: "Brooks", status: "inactive", phone: "416-555-0190", dateOfBirth: "1991-11-05" },
] as const;

const LEAD_EMAILS = [
  "maria.chen@senoria.seed",
  "james.okonkwo@senoria.seed",
  "priya.shah@senoria.seed",
  "helen.wright@senoria.seed",
  "robert.lang@senoria.seed",
  "aisha.rahman@senoria.seed",
  "david.cho@senoria.seed",
  "susan.blake@senoria.seed",
  "nina.kapoor@senoria.seed",
  "omar.farouk@senoria.seed",
];

type Rep = { id: string; firstName: string; lastName: string; email: string };

export async function seedSalesWorkspace(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed the sales workspace when NODE_ENV is production.");
  }

  const today = calendarDateInTimeZone(new Date(), TIME_ZONE);
  const yesterday = addDays(today, -1);
  const week = weekRange(today);
  const laterThisWeek = firstFutureDay(today, week.end, 2);
  const dayAfter = addDays(today, 1);
  const earlier = week.start < today ? week.start : addDays(today, -3);

  const passwordHash = await hashPassword(PASSWORD);
  const users = new Map<string, Rep>();
  for (const rep of SALES_USERS) {
    const saved = await prisma.user.upsert({
      where: { email: rep.email },
      update: {
        passwordHash,
        firstName: rep.firstName,
        lastName: rep.lastName,
        phone: rep.phone,
        role: "SALES",
        status: rep.status,
        dateOfBirth: parseIsoDate(rep.dateOfBirth),
      },
      create: {
        id: randomUUID(),
        email: rep.email,
        passwordHash,
        firstName: rep.firstName,
        lastName: rep.lastName,
        phone: rep.phone,
        role: "SALES",
        status: rep.status,
        dateOfBirth: parseIsoDate(rep.dateOfBirth),
      },
    });
    users.set(rep.key, saved);
  }

  const alex = requiredRep(users, "alex");
  const priya = requiredRep(users, "priya");
  const sam = requiredRep(users, "sam");
  const lena = requiredRep(users, "lena");
  await retirePreviousSeed(users);

  try {
    await wipeDemo([...users.values()].map((user) => user.id));

    const maria = await lead(alex, earlier, "09:00", {
      firstName: "Maria",
      lastName: "Chen",
      phone: "416-555-0142",
      email: "maria.chen@senoria.seed",
      source: "Facebook",
      about: "Daughter is asking about weekday morning care for her mother.",
    });
    await note(alex, today, "08:20", maria.id, {
      outcome: "Connected",
      text: "Daughter called about weekday morning care and asked for a short intro today.",
    });
    const mariaMeeting = await meeting(alex, today, "16:00", maria.id, {
      title: "Intro call",
      kind: "Call",
      start: "16:00",
      end: "16:30",
    });

    const james = await lead(priya, today, "08:05", {
      firstName: "James",
      lastName: "Okonkwo",
      phone: "647-555-0138",
      email: "james.okonkwo@senoria.seed",
      source: "Instagram",
      about: "New enquiry from Instagram. No follow-up time set yet.",
    });

    const shah = await lead(sam, addDays(today, -4), "10:00", {
      firstName: "Priya",
      lastName: "Shah",
      phone: "416-555-0174",
      email: "priya.shah@senoria.seed",
      source: "Facebook",
      about: "Son is comparing home care after a Facebook lead.",
    });
    const shahCall = await call(sam, yesterday, "11:00", {
      leadId: shah.id,
      phone: "416-555-0174",
      direction: "Outbound",
      result: "Connected",
      durationSeconds: 252,
    });
    await prisma.salesCall.update({
      where: { id: shahCall.id },
      data: { recordingUrl: "https://example.com/recordings/priya-shah.mp3" },
    });
    await note(sam, yesterday, "11:10", shah.id, {
      outcome: "Connected",
      text: "Spoke with her son. He wants a follow-up call today.",
      stage: "Contacted",
    });
    const shahMeeting = await meeting(sam, today, "15:00", shah.id, {
      title: "Follow-up call",
      kind: "Call",
      start: "15:00",
      end: "15:30",
    });

    const helen = await lead(alex, addDays(today, -5), "13:00", {
      firstName: "Helen",
      lastName: "Wright",
      phone: "604-555-0162",
      email: "helen.wright@senoria.seed",
      source: "Phone",
      about: "Called the office about a home visit this week.",
    });
    await call(alex, today, "09:10", {
      leadId: helen.id,
      phone: "604-555-0162",
      direction: "Inbound",
      result: "Connected",
      durationSeconds: 180,
    });
    await note(alex, today, "09:20", helen.id, {
      outcome: "Booked",
      text: "Confirmed a home visit for this afternoon.",
      stage: "Qualified",
    });
    const helenMeeting = await meeting(alex, today, "14:00", helen.id, {
      title: "Home visit",
      kind: "Visit",
      start: "14:00",
      end: "15:00",
    });

    const robert = await lead(priya, addDays(today, -6), "09:30", {
      firstName: "Robert",
      lastName: "Lang",
      phone: "905-555-0144",
      email: "robert.lang@senoria.seed",
      source: "Instagram",
      about: "Asked for a callback. We have not reached him yet.",
    });
    await call(priya, yesterday, "16:00", {
      leadId: robert.id,
      phone: "905-555-0144",
      direction: "Outbound",
      result: "No answer",
      durationSeconds: 18,
    });
    await note(priya, yesterday, "16:20", robert.id, {
      outcome: "Voicemail",
      text: "No answer. Left a voicemail asking him to call back.",
      stage: "Contacted",
    });
    const robertMeeting = await meeting(priya, yesterday, "17:00", robert.id, {
      title: "Return call",
      kind: "Call",
      start: "17:00",
      end: "17:30",
    });

    const aisha = await lead(sam, addDays(today, -8), "11:00", {
      firstName: "Aisha",
      lastName: "Rahman",
      phone: "416-555-0186",
      email: "aisha.rahman@senoria.seed",
      source: "Facebook",
      about: "Wants a home visit later this week, not today.",
    });
    await call(sam, earlier, "10:15", {
      leadId: aisha.id,
      phone: "416-555-0186",
      direction: "Outbound",
      result: "Voicemail",
      durationSeconds: 42,
    });
    at(addDays(today, -2), "12:00");
    await changeLeadStage(asAdmin(sam.id), aisha.id, "Visit booked", requestDayWindow(TIME_ZONE));
    const aishaMeeting = await meeting(sam, laterThisWeek, "13:00", aisha.id, {
      title: "Home visit",
      kind: "Visit",
      start: "13:00",
      end: "14:00",
    });

    const nina = await lead(alex, addDays(today, -3), "15:00", {
      firstName: "Nina",
      lastName: "Kapoor",
      phone: "604-555-0119",
      email: "nina.kapoor@senoria.seed",
      source: "Phone",
      about: "Comparing morning and afternoon visits.",
    });
    await call(alex, yesterday, "13:40", {
      leadId: nina.id,
      phone: "604-555-0119",
      direction: "Outbound",
      result: "No answer",
      durationSeconds: 12,
    });
    await note(alex, yesterday, "13:45", nina.id, {
      outcome: "No answer",
      text: "No answer. Try again tomorrow.",
      stage: "Contacted",
    });
    const ninaMeeting = await meeting(alex, dayAfter, "11:00", nina.id, {
      title: "Follow-up call",
      kind: "Call",
      start: "11:00",
      end: "11:30",
    });

    const omar = await lead(sam, addDays(today, -7), "14:00", {
      firstName: "Omar",
      lastName: "Farouk",
      phone: "778-555-0128",
      email: "omar.farouk@senoria.seed",
      source: "Referral",
      about: "Referred by a current family. Visit is booked later in the week.",
    });
    await call(sam, addDays(today, -4), "15:10", {
      leadId: omar.id,
      phone: "778-555-0128",
      direction: "Outbound",
      result: "Voicemail",
      durationSeconds: 36,
    });
    at(addDays(today, -2), "16:00");
    await changeLeadStage(asAdmin(sam.id), omar.id, "Qualified", requestDayWindow(TIME_ZONE));
    const omarDay = firstFutureDay(today, week.end, 3);
    const omarMeeting = await meeting(sam, omarDay, "10:30", omar.id, {
      title: "Care plan visit",
      kind: "Visit",
      start: "10:30",
      end: "11:30",
    });

    const david = await lead(alex, addDays(today, -12), "09:00", {
      firstName: "David",
      lastName: "Cho",
      phone: "236-555-0155",
      email: "david.cho@senoria.seed",
      source: "Referral",
      about: "Started service after a referral from his daughter.",
    });
    await call(alex, addDays(today, -9), "10:00", {
      leadId: david.id,
      phone: "236-555-0155",
      direction: "Outbound",
      result: "Connected",
      durationSeconds: 480,
    });
    await meeting(alex, earlier, "09:30", david.id, {
      title: "Welcome call",
      kind: "Call",
      start: "09:30",
      end: "10:00",
    });
    at(addDays(today, -1), "18:00");
    await changeLeadStage(asAdmin(alex.id), david.id, "Won", requestDayWindow(TIME_ZONE));

    const susan = await lead(priya, addDays(today, -10), "11:30", {
      firstName: "Susan",
      lastName: "Blake",
      phone: "416-555-0194",
      email: "susan.blake@senoria.seed",
      source: "Instagram",
      about: "Chose another provider.",
    });
    at(addDays(today, -3), "17:00");
    await changeLeadStage(asAdmin(priya.id), susan.id, "Lost", requestDayWindow(TIME_ZONE));

    const unmatched = await call(alex, today, "07:40", {
      phone: UNMATCHED_PHONE,
      direction: "Inbound",
      result: "Missed",
    });

    await prisma.salesRoundRobinState.upsert({
      where: { id: 1 },
      create: { id: 1, lastAssignedUserId: sam.id },
      update: { lastAssignedUserId: sam.id },
    });

    resetClock();
    const state = await assignmentState();
    const bounds = dayBounds(new Date(), TIME_ZONE);
    const admin = asAdmin(alex.id);
    const due = await namesInQueue(admin, "due", bounds);
    const overdue = await namesInQueue(admin, "overdue", bounds);
    const fresh = await namesInQueue(admin, "new", bounds);
    const alexCalls = await listCalls(
      { id: alex.id, role: "SALES" },
      { page: 1, pageSize: 100, search: "" },
      TIME_ZONE,
    );
    const weekMeetings = await listMeetings(admin, { from: week.start, to: week.end }, TIME_ZONE);
    const people = await listSalespeople("all");

    expectIncludes("due", due, ["Maria Chen", "Priya Shah", "Helen Wright"]);
    expectAbsent("due", due, ["James Okonkwo", "Robert Lang", "David Cho", "Susan Blake"]);
    expectIncludes("overdue", overdue, ["Robert Lang"]);
    expectAbsent("overdue", overdue, ["David Cho", "Susan Blake", "Maria Chen", "Helen Wright"]);
    expectIncludes("new", fresh, ["Maria Chen", "James Okonkwo"]);
    expectAbsent("new", fresh, ["Priya Shah", "Helen Wright", "David Cho"]);
    if (!alexCalls.data.some((row) => row.leadId === null && row.phone === UNMATCHED_PHONE)) {
      throw new Error("Alex's call list is missing the unmatched inbound.");
    }
    const recordings = alexCalls.data.filter((row) => row.recordingAvailable).length;
    const shahVisible = await listCalls(admin, { page: 1, pageSize: 100, search: "", leadId: shah.id }, TIME_ZONE);
    if (shahVisible.data.filter((row) => row.recordingAvailable).length !== 1) {
      throw new Error("Expected exactly one recorded call, on Priya Shah.");
    }
    if (recordings > 1) {
      throw new Error("Alex can see more than one recorded call.");
    }
    const todayMeetings = weekMeetings.filter((row) => calendarDateInTimeZone(new Date(row.startAt), TIME_ZONE) === today);
    if (todayMeetings.length < 3) {
      throw new Error(`Expected at least 3 meetings today, found ${todayMeetings.length}.`);
    }
    for (const rep of [alex, priya, sam]) {
      const row = people.find((person) => person.id === rep.id);
      if (!row || row.assignedLeadCount < 1 || !row.inRoundRobin) {
        throw new Error(`${rep.firstName} should have open leads and be in the round-robin.`);
      }
    }
    const lenaRow = people.find((person) => person.id === lena.id);
    if (!lenaRow || lenaRow.inRoundRobin || lenaRow.assignedLeadCount !== 0) {
      throw new Error("Lena Brooks should be inactive, out of the round-robin, and have no open leads.");
    }
    if (!state.activeRepIds.includes(alex.id) || !state.activeRepIds.includes(priya.id) || !state.activeRepIds.includes(sam.id)) {
      throw new Error("Assignment state is missing an active seed rep.");
    }
    if (state.activeRepIds.includes(lena.id) || !state.nextOwnerId || !state.nextOwnerName) {
      throw new Error("Assignment state should skip Lena and name the next owner.");
    }

    console.log(`Sales workspace seed ready. Vancouver today: ${today}. Week: ${week.start} to ${week.end}.`);
    console.log(`Password for every seed sales login: ${PASSWORD}`);
    console.log("Round-robin cursor is Sam Ortiz, so the next automatic lead goes to the following active rep.");
    console.log(`Next owner: ${state.nextOwnerName} (${state.nextOwnerId}). Active reps: ${state.activeRepIds.join(", ")}.`);
    console.log("Lena Brooks is inactive and is not in the rotation.");
    for (const rep of SALES_USERS) {
      const saved = requiredRep(users, rep.key);
      console.log(`  ${saved.email}  ${rep.status}  ${saved.id}`);
    }
    const createdLeads = [
      ["Maria Chen", maria.id],
      ["James Okonkwo", james.id],
      ["Priya Shah", shah.id],
      ["Helen Wright", helen.id],
      ["Robert Lang", robert.id],
      ["Aisha Rahman", aisha.id],
      ["David Cho", david.id],
      ["Susan Blake", susan.id],
      ["Nina Kapoor", nina.id],
      ["Omar Farouk", omar.id],
    ];
    for (const [name, id] of createdLeads) {
      console.log(`  lead  ${name}  ${id}`);
    }
    console.log(`  call  unmatched inbound  ${unmatched.id}`);
    console.log(`  call  Priya Shah recorded  ${shahCall.id}`);
    for (const [name, id] of [
      ["Maria intro call", mariaMeeting.id],
      ["Priya Shah follow-up", shahMeeting.id],
      ["Helen home visit", helenMeeting.id],
      ["Robert return call", robertMeeting.id],
      ["Aisha home visit", aishaMeeting.id],
      ["Nina follow-up", ninaMeeting.id],
      ["Omar care plan visit", omarMeeting.id],
    ]) {
      console.log(`  meeting  ${name}  ${id}`);
    }
    console.log(`Queues: due=${due.join(", ")}; overdue=${overdue.join(", ")}; new=${fresh.join(", ")}`);
  } finally {
    resetClock();
  }
}

async function lead(
  owner: Rep,
  day: string,
  time: string,
  input: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    source: LeadSource;
    about: string;
  },
) {
  at(day, time);
  return createLead(
    asAdmin(owner.id),
    { ...input, ownerId: owner.id },
    requestDayWindow(TIME_ZONE),
  );
}

async function note(
  owner: Rep,
  day: string,
  time: string,
  leadId: string,
  input: { outcome: "Connected" | "No answer" | "Voicemail" | "Booked"; text: string; stage?: LeadStage },
) {
  at(day, time);
  return addLeadNote(asAdmin(owner.id), leadId, input, requestDayWindow(TIME_ZONE), TIME_ZONE);
}

async function call(
  owner: Rep,
  day: string,
  time: string,
  input: {
    leadId?: string;
    phone: string;
    direction: "Outbound" | "Inbound";
    result: "Connected" | "No answer" | "Voicemail" | "Missed";
    durationSeconds?: number;
  },
) {
  const started = at(day, time);
  const ended = input.durationSeconds === undefined ? undefined : new Date(started.getTime() + input.durationSeconds * 1000).toISOString();
  return createCall(asAdmin(owner.id), {
    leadId: input.leadId,
    phone: input.phone,
    direction: input.direction,
    startedAt: started.toISOString(),
    endedAt: ended,
    durationSeconds: input.durationSeconds,
    result: input.result,
  });
}

async function meeting(
  owner: Rep,
  day: string,
  time: string,
  leadId: string,
  input: { title: string; kind: "Call" | "Visit"; start: string; end: string },
) {
  at(day, time);
  return createMeeting(asAdmin(owner.id), {
    leadId,
    title: input.title,
    kind: input.kind,
    startAt: zonedDateTimeToUtc(day, input.start, TIME_ZONE).toISOString(),
    endAt: zonedDateTimeToUtc(day, input.end, TIME_ZONE).toISOString(),
  });
}

function at(day: string, time: string): Date {
  const instant = zonedDateTimeToUtc(day, time, TIME_ZONE);
  setClock({ now: () => new Date(instant.getTime()) });
  return instant;
}

function asAdmin(id: string): SalesActor {
  return { id, role: "ADMIN" };
}

function requiredRep(users: Map<string, Rep>, key: string): Rep {
  const rep = users.get(key);
  if (!rep) {
    throw new Error(`Missing seed user ${key}`);
  }
  return rep;
}

async function retirePreviousSeed(current: Map<string, Rep>): Promise<void> {
  const retired = await prisma.user.findMany({
    where: { email: { in: [...PREVIOUS_SEED_EMAILS] } },
    select: { id: true },
  });
  if (retired.length === 0) {
    return;
  }
  const ids = retired.map((user) => user.id).filter((id) => ![...current.values()].some((rep) => rep.id === id));
  if (ids.length === 0) {
    return;
  }
  await wipeOwned(ids);
  await prisma.user.updateMany({ where: { id: { in: ids } }, data: { status: "inactive" } });
}

async function wipeDemo(ownerIds: string[]): Promise<void> {
  const leads = await prisma.lead.findMany({
    where: {
      OR: [
        { email: { in: LEAD_EMAILS } },
        { phone: { in: ["416-555-0142", "647-555-0138", "416-555-0174", "604-555-0162", "905-555-0144", "416-555-0186", "236-555-0155", "416-555-0194", "604-555-0119", "778-555-0128"] } },
      ],
    },
    select: { id: true },
  });
  await wipeLeadIds(leads.map((row) => row.id));
  if (ownerIds.length > 0) {
    await prisma.salesCall.deleteMany({
      where: { leadId: null, phone: UNMATCHED_PHONE, ownerId: { in: ownerIds } },
    });
  }
}

async function wipeOwned(ownerIds: string[]): Promise<void> {
  const leads = await prisma.lead.findMany({
    where: { ownerId: { in: ownerIds } },
    select: { id: true },
  });
  await wipeLeadIds(leads.map((row) => row.id));
  await prisma.salesCall.deleteMany({ where: { ownerId: { in: ownerIds }, leadId: null } });
  await prisma.salesMeeting.deleteMany({ where: { ownerId: { in: ownerIds } } });
}

async function wipeLeadIds(leadIds: string[]): Promise<void> {
  if (leadIds.length === 0) {
    return;
  }
  await prisma.salesMeeting.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.salesCall.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.leadTimelineEvent.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
}

async function namesInQueue(actor: SalesActor, queue: "due" | "overdue" | "new", bounds: ReturnType<typeof dayBounds>) {
  const page = await listLeads(actor, { page: 1, pageSize: 100, search: "", queue }, bounds);
  return page.data.map((row) => `${row.firstName} ${row.lastName}`);
}

function expectIncludes(label: string, actual: string[], required: string[]) {
  const missing = required.filter((name) => !actual.includes(name));
  if (missing.length > 0) {
    throw new Error(`${label} is missing ${missing.join(", ")}. Actual: ${actual.join(", ") || "(none)"}`);
  }
}

function expectAbsent(label: string, actual: string[], forbidden: string[]) {
  const present = forbidden.filter((name) => actual.includes(name));
  if (present.length > 0) {
    throw new Error(`${label} should not include ${present.join(", ")}.`);
  }
}

function weekRange(today: string): { start: string; end: string } {
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const fromMonday = (weekday + 6) % 7;
  const start = addDays(today, -fromMonday);
  return { start, end: addDays(start, 6) };
}

function firstFutureDay(today: string, weekEnd: string, daysAhead: number): string {
  const target = addDays(today, daysAhead);
  if (target > today && target <= weekEnd) {
    return target;
  }
  if (weekEnd > today) {
    return weekEnd;
  }
  return addDays(today, Math.max(daysAhead, 1));
}

const invokedDirectly = process.argv[1]?.includes("seed-sales");
if (invokedDirectly) {
  seedSalesWorkspace()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Sales seed failed.";
      console.error(message);
      process.exitCode = 1;
    })
    .finally(async () => {
      resetClock();
      await prisma.$disconnect();
    });
}
