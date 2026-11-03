import { processAppointmentReminders } from "../lib/appointments/reminders.ts";

const result = await processAppointmentReminders();
console.log(JSON.stringify(result));
