type EducationGraceState = {
  inGrace: boolean;
  graceDaysRemaining: number | null;
};

export function educationGraceWarningMessage(status: EducationGraceState | null | undefined): string | null {
  if (!status?.inGrace || status.graceDaysRemaining === null) return null;
  if (status.graceDaysRemaining === 0) {
    return "Grace period ističe danas po vremenu u Beogradu. Evidentirajte uplatu pre isteka da kursevi ne bi bili povučeni iz javne ponude.";
  }
  const dayLabel = status.graceDaysRemaining === 1
    ? "beogradski kalendarski dan"
    : "beogradskih kalendarskih dana";
  return `Preostalo je ${status.graceDaysRemaining} ${dayLabel}. Evidentirajte uplatu pre isteka da kursevi ne bi bili povučeni iz javne ponude.`;
}