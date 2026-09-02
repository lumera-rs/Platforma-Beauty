export const CANCELLATION_FLAG_THRESHOLD = 1 / 3;
export const CANCELLATION_FLAG_MIN_VOLUME = 3;

export type CampaignCancellationCounts = {
  attributedAppointments?: number | null;
  cancelledAttributedAppointments?: number | null;
};

export function getCampaignCancellationWarning(item: CampaignCancellationCounts) {
  const attributedAppointments = item.attributedAppointments ?? 0;
  const cancelledAppointments = item.cancelledAttributedAppointments ?? 0;
  const totalAttributedBookings = attributedAppointments + cancelledAppointments;
  const cancellationShare = totalAttributedBookings > 0
    ? cancelledAppointments / totalAttributedBookings
    : 0;
  const cancellationShareLabel = `${Math.round(cancellationShare * 100)}%`;

  return {
    isFlagged: totalAttributedBookings >= CANCELLATION_FLAG_MIN_VOLUME
      && cancellationShare >= CANCELLATION_FLAG_THRESHOLD,
    cancellationShare,
    cancellationShareLabel,
    cancelledAppointments,
    totalAttributedBookings,
    explanation: `Visok udeo otkazanih termina: ${cancellationShareLabel} (${cancelledAppointments} od ${totalAttributedBookings} kampanjom pripisanih termina). Proverite poruke, ponude ili publiku kampanje.`,
  };
}