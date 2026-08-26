const REFERRAL_KEY = "lumera_referral_code";
const REFERRAL_EXPIRY_KEY = "lumera_referral_expiry";
const EXPIRY_DAYS = 30;

export function captureReferralCode(code: string | null) {
  if (!code) return;
  
  // Do not overwrite an unexpired first touch
  const existingCode = localStorage.getItem(REFERRAL_KEY);
  const existingExpiry = localStorage.getItem(REFERRAL_EXPIRY_KEY);
  
  if (existingCode && existingExpiry) {
    const expiryTime = parseInt(existingExpiry, 10);
    if (Date.now() < expiryTime) {
      return; // Keep existing unexpired first touch
    }
  }

  // Set new first touch
  const expiryTime = Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  localStorage.setItem(REFERRAL_KEY, code);
  localStorage.setItem(REFERRAL_EXPIRY_KEY, expiryTime.toString());
}

export function getStoredReferralCode(): string | undefined {
  const code = localStorage.getItem(REFERRAL_KEY);
  const expiry = localStorage.getItem(REFERRAL_EXPIRY_KEY);
  
  if (!code || !expiry) return undefined;
  
  const expiryTime = parseInt(expiry, 10);
  if (Date.now() > expiryTime) {
    clearStoredReferralCode();
    return undefined;
  }
  
  return code;
}

export function clearStoredReferralCode() {
  localStorage.removeItem(REFERRAL_KEY);
  localStorage.removeItem(REFERRAL_EXPIRY_KEY);
}