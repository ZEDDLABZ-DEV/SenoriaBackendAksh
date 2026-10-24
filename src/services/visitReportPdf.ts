import PDFDocumentImport from "pdfkit";
import { validation } from "../lib/errors";
import { formatDateTimeInTimeZone } from "../lib/timezone";
import type { ReportFilters } from "../validation/reports";
import { buildVisitReport, type ReportDay, type ReportPerson } from "./visitReport.service";

const MAX_PDF_DAYS = 500;

const PDFDocument = PDFDocumentImport as unknown as new (
  options?: PDFKit.PDFDocumentOptions,
) => PDFKit.PDFDocument;

function personName(person: ReportPerson): string {
  return `${person.firstName} ${person.lastName}`;
}

function hoursLabel(value: number | null): string {
  return value === null ? "none" : value.toFixed(2);
}

function renderPdf(report: Awaited<ReturnType<typeof buildVisitReport>>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const ensure = (height: number) => {
      if (doc.y + height > bottom()) {
        doc.addPage();
      }
    };
    const line = (text: string, options?: { bold?: boolean }) => {
      ensure(16);
      doc.font(options?.bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).text(text, { width: 516 });
    };

    doc.font("Helvetica-Bold").fontSize(16).text("Caregiver visit report");
    doc.moveDown(0.4);
    line(`Period: ${report.period}`);
    line(`Dates: ${report.from} to ${report.to}`);
    line(`Timezone: ${report.timeZone}`);
    line(`Caregiver: ${report.filters.caregiverName ?? "All"}`);
    line(`Client: ${report.filters.clientName ?? "All"}`);
    line(`Status: ${report.filters.status}`);
    line(`Generated: ${formatDateTimeInTimeZone(new Date(report.generatedAt), report.timeZone)}`);
    doc.moveDown(0.6);
    line("Summary", { bold: true });
    line(`Scheduled days: ${report.summary.scheduledDays}`);
    line(`Completed days: ${report.summary.completedDays}`);
    line(`Pending days: ${report.summary.pendingDays}`);
    line(`Missed days: ${report.summary.missedDays}`);
    line(`Cancelled days: ${report.summary.cancelledDays}`);
    line(`Total hours: ${report.summary.totalHours.toFixed(2)}`);
    line(`Average hours: ${report.summary.averageHours === null ? "none" : report.summary.averageHours.toFixed(2)}`);
    line(
      `Completion rate: ${
        report.summary.completionRate === null ? "none" : `${Math.round(report.summary.completionRate * 1000) / 10}%`
      }`,
    );

    if (report.rows.length === 0) {
      doc.moveDown(0.8);
      line("No visits in this view.");
      doc.end();
      return;
    }

    for (const row of report.rows) {
      writeDay(doc, row, report.timeZone, line, ensure);
    }
    doc.end();
  });
}

function writeDay(
  doc: PDFKit.PDFDocument,
  row: ReportDay,
  timeZone: string,
  line: (text: string, options?: { bold?: boolean }) => void,
  ensure: (height: number) => void,
): void {
  doc.moveDown(0.8);
  ensure(36);
  doc.moveTo(48, doc.y).lineTo(564, doc.y).stroke();
  doc.moveDown(0.4);
  line(`${row.serviceDate}  ${personName(row.caregiver)}  ${personName(row.client)}`, { bold: true });
  line(`Status: ${row.status}`);
  line(`Visit: ${row.description}`);
  line(`Type: ${row.appointmentType}`);
  line(
    `Scheduled: ${row.scheduledStartTime}-${row.scheduledEndTime} (${row.scheduledHours.toFixed(2)} h)`,
  );
  line(
    `Address: ${[row.locationStreet, row.locationCity, row.locationState, row.locationZipCode].filter(Boolean).join(", ")}`,
  );
  line(`Check-in: ${row.checkInAt ? formatDateTimeInTimeZone(new Date(row.checkInAt), timeZone) : "none"}`);
  line(`Completed at: ${row.completedAt ? formatDateTimeInTimeZone(new Date(row.completedAt), timeZone) : "none"}`);
  if (row.arrival.status === "late") {
    line(`Arrival: late by ${row.arrival.minutesLate} minute${row.arrival.minutesLate === 1 ? "" : "s"}`);
  } else if (row.arrival.status === "no_check_in") {
    line("Arrival: no check-in");
  } else if (row.arrival.minutesEarly > 0) {
    line(`Arrival: on time, ${row.arrival.minutesEarly} minute${row.arrival.minutesEarly === 1 ? "" : "s"} early`);
  } else {
    line("Arrival: on time");
  }
  line(`Original hours: ${hoursLabel(row.originalHours)}`);
  line(`Corrected hours: ${hoursLabel(row.adjustedHours)}`);
  line(`Hours used: ${hoursLabel(row.hoursUsed)}`);
  line(
    `Checklist: tasks ${row.counts.tasks.completed}/${row.counts.tasks.total}, medications ${row.counts.medications.completed}/${row.counts.medications.total}, diet ${row.counts.diet.completed}/${row.counts.diet.total}, hygiene ${row.counts.hygiene.completed}/${row.counts.hygiene.total}`,
  );
  for (const item of row.items) {
    const when =
      item.completed && item.completedAt
        ? ` - ${formatDateTimeInTimeZone(new Date(item.completedAt), timeZone)}${item.caregiver ? ` by ${personName(item.caregiver)}` : ""}`
        : "";
    const detail = item.detail ? ` (${item.detail})` : "";
    line(`${item.completed ? "[x]" : "[ ]"} ${item.itemType}: ${item.name}${detail}${when}`);
  }
  if (row.adjustments.length > 0) {
    line("Hour corrections", { bold: true });
    for (const adjustment of row.adjustments) {
      line(
        `${formatDateTimeInTimeZone(new Date(adjustment.createdAt), timeZone)}  ${adjustment.adjustedHours.toFixed(2)} h by ${personName(adjustment.admin)} - ${adjustment.reason}`,
      );
    }
  }
}

export async function visitReportPdf(filters: ReportFilters, timeZone: string, today: string) {
  const report = await buildVisitReport(filters, timeZone, today);
  if (report.rows.length > MAX_PDF_DAYS) {
    throw validation("This report is too large to export. Narrow the date range or filters.", {
      range: ["Export at most 500 days. Narrow the date range or filters."],
    });
  }
  const buffer = await renderPdf(report);
  return {
    filename: `visit-report-${report.from}-to-${report.to}.pdf`,
    buffer,
  };
}
