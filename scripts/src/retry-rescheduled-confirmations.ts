export {};

const apiBaseUrl = process.env["LUMERA_API_BASE_URL"]?.replace(/\/$/, "");
const secret = process.env["CONFIRMATION_RETRY_JOB_SECRET"];
if (!apiBaseUrl || !secret) {
  throw new Error("LUMERA_API_BASE_URL i CONFIRMATION_RETRY_JOB_SECRET su obavezni za retry potvrda.");
}

const response = await fetch(`${apiBaseUrl}/api/internal/jobs/rescheduled-confirmation-retries`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-lumera-job-key": secret },
  body: JSON.stringify({}),
});
if (!response.ok) throw new Error(`Retry potvrda nije uspeo: ${response.status} ${(await response.text()).slice(0, 500)}`);
process.stdout.write(`${JSON.stringify(await response.json())}\n`);