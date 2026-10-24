import { formatClock, formatDate } from "../lib/dates";

export interface DoctorAppointmentRow {
  id: string;
  clientId: string;
  typeId: string;
  doctorName: string;
  specialty: string;
  phone: string;
  clinicName: string;
  scheduledDate: Date;
  startTime: string;
  endTime: string;
  description: string;
  status: string;
  client: { firstName: string; lastName: string };
  type: { name: string };
}

export function serializeDoctorAppointment(row: DoctorAppointmentRow) {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: `${row.client.firstName} ${row.client.lastName}`.trim(),
    typeId: row.typeId,
    typeName: row.type.name,
    status: row.status,
    doctorName: row.doctorName,
    specialty: row.specialty,
    phone: row.phone,
    clinicName: row.clinicName,
    scheduledDate: formatDate(row.scheduledDate),
    startTime: formatClock(row.startTime),
    endTime: formatClock(row.endTime),
    description: row.description,
  };
}
