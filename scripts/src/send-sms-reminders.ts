export {};

const apiBaseUrl = process.env["LUMERA_API_BASE_URL"]?.replace(/\/$/, "");
const secret = process.env["SMS_REMINDER_JOB_SECRET"];
if (!apiBaseUrl || !secret) {
  throw new Error("LUMERA_API_BASE_URL i SMS_REMINDER_JOB_SECRET su obavezni za SMS reminder posao.");
}
const response = await fetch(`${apiBaseUrl}/api/internal/jobs/sms-reminders`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-lumera-job-key": secret },
  body: JSON.stringify({}),
});
if (!response.ok) throw new Error(`SMS reminder posao nije uspeo: ${response.status} ${(await response.text()).slice(0, 500)}`);
process.stdout.write(`${JSON.stringify(await response.json())}\n`);