import { useState, useEffect } from "react";
import { useGetSalonBookingSettings, useReplaceSalonBookingSettings, getApiErrorMessage, getGetSalonBookingSettingsQueryKey, type SalonBookingSettingsInput, SalonBookingSettingsInputSlotGranularityMinutes } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export function BookingSettingsForm({ onSaved }: { onSaved?: () => void }) {
  const settingsQueryKey = getGetSalonBookingSettingsQueryKey();
  const { data: settings, isLoading, error: settingsError, refetch } = useGetSalonBookingSettings({
    query: { queryKey: settingsQueryKey }
  });

  const replaceSettings = useReplaceSalonBookingSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<string | null>(null);

  const [formData, setFormData] = useState<SalonBookingSettingsInput>({
    slotGranularityMinutes: SalonBookingSettingsInputSlotGranularityMinutes.NUMBER_15,
    minimumLeadTimeMinutes: 60,
    cancellationDeadlineMinutes: 1440,
    reminderOffsetsMinutes: [1440],
    reminderChannels: [],
    maxVisitGapMinutes: 60,
    minimumUsefulLateTreatmentMinutes: 15,
    dateHours: [],
    resourceDowntime: []
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        slotGranularityMinutes: settings.slotGranularityMinutes,
        minimumLeadTimeMinutes: settings.minimumLeadTimeMinutes,
        cancellationDeadlineMinutes: settings.cancellationDeadlineMinutes,
        reminderOffsetsMinutes: settings.reminderOffsetsMinutes,
        reminderChannels: settings.reminderChannels,
        maxVisitGapMinutes: settings.maxVisitGapMinutes,
        minimumUsefulLateTreatmentMinutes: settings.minimumUsefulLateTreatmentMinutes,
        dateHours: settings.dateHours,
        resourceDowntime: settings.resourceDowntime
      });
    }
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);

    try {
      // Orval's generated mutation accepts a variables wrapper whose `data`
      // member is the request body. Passing the body itself silently produces
      // an empty request when the call site is cast.
      const savedSettings = await replaceSettings.mutateAsync({ data: formData });
      queryClient.setQueryData(settingsQueryKey, savedSettings);
      await queryClient.invalidateQueries({ queryKey: settingsQueryKey, refetchType: "all" });
      toast.success("Podešavanja su sačuvana");
      onSaved?.();
    } catch (error) {
      const message = getApiErrorMessage(error, "Podešavanja nisu sačuvana. Pokušajte ponovo.");
      setSaveError(message);
      toast.error("Greška pri čuvanju podešavanja", { description: message });
    }
  };

  if (isLoading) {
    return <div className="flex justify-center p-8" role="status" aria-label="Učitavanje podešavanja"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (settingsError) {
    return (
      <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-4" role="alert">
        <p className="text-sm text-destructive">
          {getApiErrorMessage(settingsError, "Podešavanja rezervacija nije moguće učitati.")}
        </p>
        <Button type="button" variant="outline" onClick={() => void refetch()}>
          Pokušaj ponovo
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="booking-slot-granularity">Korak pri rezervaciji (minuti)</Label>
          <select
            id="booking-slot-granularity"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={formData.slotGranularityMinutes}
            onChange={e => setFormData({
              ...formData,
              slotGranularityMinutes: Number(e.target.value) as SalonBookingSettingsInput["slotGranularityMinutes"]
            })}
          >
            <option value={5}>5 minuta</option>
            <option value={10}>10 minuta</option>
            <option value={15}>15 minuta</option>
            <option value={30}>30 minuta</option>
          </select>
          <p className="text-xs text-muted-foreground">Određuje na koliko minuta korisnici mogu da izaberu vreme (npr. 10:00, 10:15).</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="booking-minimum-lead">Minimalno vreme pre rezervacije (minuti)</Label>
          <Input
            id="booking-minimum-lead"
            type="number"
            min="0"
            value={formData.minimumLeadTimeMinutes}
            onChange={e => setFormData({ ...formData, minimumLeadTimeMinutes: Number(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">Koliko ranije klijent mora da rezerviše termin (npr. 60 min znači da ne može rezervisati za 15 min).</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="booking-cancellation-deadline">Minimalno vreme za otkazivanje (minuti)</Label>
          <Input
            id="booking-cancellation-deadline"
            type="number"
            min="0"
            value={formData.cancellationDeadlineMinutes}
            onChange={e => setFormData({ ...formData, cancellationDeadlineMinutes: Number(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">Rok do kojeg je dozvoljeno besplatno otkazivanje (npr. 1440 min = 24h).</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="booking-maximum-visit-gap">Maksimalna pauza između spojenih tretmana (minuti)</Label>
          <Input
            id="booking-maximum-visit-gap"
            type="number"
            min="0"
            value={formData.maxVisitGapMinutes}
            onChange={e => setFormData({ ...formData, maxVisitGapMinutes: Number(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">Maksimalna dozvoljena rupa u vremenu kada klijent zakazuje više usluga odjednom.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="booking-minimum-useful-late-treatment">Minimalno korisno vreme pri kašnjenju (minuti)</Label>
          <Input
            id="booking-minimum-useful-late-treatment"
            type="number"
            min="0"
            value={formData.minimumUsefulLateTreatmentMinutes}
            onChange={e => setFormData({ ...formData, minimumUsefulLateTreatmentMinutes: Number(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">Koliko je minimalno potrebno minuta da bi tretman uopšte bio urađen u slučaju kašnjenja.</p>
        </div>
      </div>

      {saveError && (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

      <Button type="submit" disabled={replaceSettings.isPending}>
        {replaceSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sačuvaj podešavanja
      </Button>
    </form>
  );
}
