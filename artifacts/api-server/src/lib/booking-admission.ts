import type { RequestHandler } from "express";

const bookingMaxInFlightPerProcess = (() => {
  const raw = process.env.BOOKING_MAX_IN_FLIGHT_PER_PROCESS ?? "0";
  if (!/^\d+$/.test(raw) || Number(raw) > 10_000) {
    throw new Error("BOOKING_MAX_IN_FLIGHT_PER_PROCESS must be an integer from 0 to 10000.");
  }
  return Number(raw);
})();

export function createBookingAdmissionGate(maxInFlight: number): RequestHandler {
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 0 || maxInFlight > 10_000) {
    throw new Error("Booking admission limit must be an integer from 0 to 10000.");
  }
  let requestsInFlight = 0;
  return (_req, res, next) => {
    if (maxInFlight === 0) {
      next();
      return;
    }
    if (requestsInFlight >= maxInFlight) {
      res.setHeader("Retry-After", "2");
      res.status(429).json({
        code: "BOOKING_CAPACITY",
        error: "Sistem za zakazivanje je trenutno zauzet. Pokušajte ponovo za nekoliko trenutaka.",
      });
      return;
    }
    requestsInFlight += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      requestsInFlight -= 1;
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}

export const admitBookingRequest = createBookingAdmissionGate(bookingMaxInFlightPerProcess);