import { useState, useEffect } from "react";
import {
  BookingReminderChannel,
  SalonBookingSettingsInputCancellationDeadlineMinutes,
  SalonBookingSettingsInputReminderOffsetsMinutesItem,
  SalonBookingSettingsInputSlotGranularityMinutes,
  getApiErrorMessage,
  getGetSalonBookingSettingsQueryKey,
  type SalonBookingSettingsInput,
  type SalonDateHours,
  useGetSalonBookingSettings,
  useReplaceSalonBookingSettings
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const CANCELLATION_OPTIONS = [
  { value: SalonBookingSettingsInputCancellationDeadlineMinutes.NUMBER_720, label: "12 sati" },
  { value: SalonBookingSettingsInputCancellationDeadlineMinutes.NUMBER_1440, label: "24 sata" },
  { value: SalonBookingSettingsInputCancellationDeadlineMinutes.NUMBER_2880, label: "48 sati" }
] as const;

const REMINDER_OFFSET_OPTIONS = [
  { value: SalonBookingSettingsInputReminderOffsetsMinutesItem.NUMBER_120, label: "2 sata pre termina" },
  { value: SalonBookingSettingsInputReminderOffsetsMinutesItem.NUMBER_720, label: "12 sati pre termina" },
  { value: SalonBookingSettingsInputReminderOffsetsMinutesItem.NUMBER_1440, label: "24 sata pre termina" }
] as const;

const REMINDER_CHANNEL_OPTIONS = [
  {
    value: BookingReminderChannel.sms,
    label: "SMS",
    description: "Dostupno samo kada klijent ima verifikovan broj telefona."
  },
  {
    value: BookingReminderChannel.email,
    label: "E-mail",
    description: "Dostupno samo kada klijent ima unetu e-mail adresu."
  },
  {
    value: BookingReminderChannel.push,
    label: "Push obaveštenje",
    description: "LUMERA obaveštenje unutar aplikacije."
  }
] as const;

export function validateDateHours(dateHours: SalonDateHours[]): string | null {
  const dates = dateHours.map(override => override.date);
  if (dates.some((date, index) => dates.indexOf(date) !== index)) {
    return "Svaki datum može imati samo jedno posebno radno vreme.";
  }

  for (const override of dateHours) {
    if (!override.date) {
      return "Izaberite datum za svako posebno radno vreme.";
    }
    if (!override.closed) {
      if (!override.openTime || !override.closeTime) {
        return `Unesite vreme otvaranja i zatvaranja za ${override.date}.`;
      }
      if (override.openTime >= override.closeTime) {
        return `Vreme zatvaranja mora biti posle vremena otvaranja za ${override.date}.`;
      }
    }
  }

  return null;
}

export function BookingSettingsForm({ onSaved }: { onSaved?: () => void }) {
  const settingsQueryKey = getGetSalonBookingSettingsQueryKey();
  const { data: settings, isLoading, error: settingsError, refetch } = useGetSalonBookingSettings({
    query: { queryKey: settingsQueryKey }
  });

  const replaceSettings = useReplaceSalonBookingSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dateHoursError, setDateHoursError] = useState<string | null>(null);
  const [newOverrideDate, setNewOverrideDate] = useState("");

  const [formData, setFormData] = useState<SalonBookingSettingsInput>({
    slotGranularityMinutes: SalonBookingSettingsInputSlotGranularityMinutes.NUMBER_15,
    minimumLeadTimeMinutes: 60,
    cancellationDeadlineMinutes: SalonBookingSettingsInputCancellationDeadlineMinutes.NUMBER_1440,
    reminderOffsetsMinutes: [SalonBookingSettingsInputReminderOffsetsMinutesItem.NUMBER_1440],
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
        dateHours: settings.dateHours.map(override => ({
          ...override,
          date: override.date.slice(0, 10)
        })),
        resourceDowntime: settings.resourceDowntime
      });
    }
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    const validationError = validateDateHours(formData.dateHours);
    setDateHoursError(validationError);
    if (validationError) return;

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

  const addDateOverride = () => {
    if (!newOverrideDate) {
      setDateHoursError("Izaberite datum koji želite da dodate.");
      return;
    }
    if (formData.dateHours.some(override => override.date === newOverrideDate)) {
      setDateHoursError("Posebno radno vreme za izabrani datum već postoji.");
      return;
    }

    setFormData(current => ({
      ...current,
      dateHours: [
        ...current.dateHours,
        {
          date: newOverrideDate,
          closed: true,
          openTime: null,
          closeTime: null,
          reason: null
        }
      ]
    }));
    setNewOverrideDate("");
    setDateHoursError(null);
  };

  const updateDateOverride = (index: number, updates: Partial<SalonDateHours>) => {
    setFormData(current => ({
      ...current,
      dateHours: current.dateHours.map((override, overrideIndex) =>
        overrideIndex === index ? { ...override, ...updates } : override
      )
    }));
    setDateHoursError(null);
  };

  const removeDateOverride = (index: number) => {
    setFormData(current => ({
      ...current,
      dateHours: current.dateHours.filter((_, overrideIndex) => overrideIndex !== index)
    }));
    setDateHoursError(null);
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
          <Label htmlFor="booking-cancellation-deadline">Rok za besplatno otkazivanje</Label>
          <select
            id="booking-cancellation-deadline"
            data-testid="select-cancellation-deadline"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={formData.cancellationDeadlineMinutes}
            onChange={e => setFormData({
              ...formData,
              cancellationDeadlineMinutes: Number(e.target.value) as SalonBookingSettingsInput["cancellationDeadlineMinutes"]
            })}
          >
            {CANCELLATION_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Najkasnije vreme pre termina kada klijent može besplatno da otkaže.</p>
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

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Vreme slanja podsetnika</legend>
        <p className="text-sm text-muted-foreground">Izaberite bilo koju kombinaciju vremena. Ako nijedno nije izabrano, podsetnici se ne zakazuju.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {REMINDER_OFFSET_OPTIONS.map(option => {
            const checked = formData.reminderOffsetsMinutes.includes(option.value);
            return (
              <div key={option.value} className="flex items-center gap-2">
                <Checkbox
                  id={`booking-reminder-offset-${option.value}`}
                  data-testid={`checkbox-reminder-offset-${option.value}`}
                  checked={checked}
                  onCheckedChange={nextChecked => setFormData(current => ({
                    ...current,
                    reminderOffsetsMinutes: nextChecked
                      ? [...current.reminderOffsetsMinutes, option.value].sort((a, b) => a - b)
                      : current.reminderOffsetsMinutes.filter(value => value !== option.value)
                  }))}
                />
                <Label htmlFor={`booking-reminder-offset-${option.value}`} className="font-normal">
                  {option.label}
                </Label>
              </div>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Kanali za podsetnike</legend>
        <p className="text-sm text-muted-foreground">Kanali se biraju nezavisno i koriste se kada su kontakt podaci klijenta dostupni.</p>
        <div className="grid gap-3 md:grid-cols-3">
          {REMINDER_CHANNEL_OPTIONS.map(option => {
            const checked = formData.reminderChannels.includes(option.value);
            return (
              <div key={option.value} className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox
                  id={`booking-reminder-channel-${option.value}`}
                  data-testid={`checkbox-reminder-channel-${option.value}`}
                  aria-describedby={`booking-reminder-channel-description-${option.value}`}
                  className="mt-0.5"
                  checked={checked}
                  onCheckedChange={nextChecked => setFormData(current => ({
                    ...current,
                    reminderChannels: nextChecked
                      ? [...current.reminderChannels, option.value]
                      : current.reminderChannels.filter(value => value !== option.value)
                  }))}
                />
                <div className="space-y-1">
                  <Label htmlFor={`booking-reminder-channel-${option.value}`}>{option.label}</Label>
                  <p id={`booking-reminder-channel-description-${option.value}`} className="text-xs text-muted-foreground">
                    {option.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>

      <section className="space-y-4 rounded-lg border p-4" aria-labelledby="date-hours-heading">
        <div>
          <h3 id="date-hours-heading" className="text-sm font-medium">Posebno radno vreme po datumu</h3>
          <p className="mt-1 text-sm text-muted-foreground">Dodajte praznike i druge datume kada je salon zatvoren ili radi drugačije.</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="w-full space-y-2 sm:max-w-xs">
            <Label htmlFor="booking-new-override-date">Datum</Label>
            <Input
              id="booking-new-override-date"
              data-testid="input-new-date-override"
              type="date"
              value={newOverrideDate}
              onChange={event => {
                setNewOverrideDate(event.target.value);
                setDateHoursError(null);
              }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            data-testid="button-add-date-override"
            onClick={addDateOverride}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Dodaj datum
          </Button>
        </div>

        {dateHoursError && (
          <p className="text-sm text-destructive" role="alert" data-testid="error-date-overrides">
            {dateHoursError}
          </p>
        )}

        {formData.dateHours.length === 0 ? (
          <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground" data-testid="status-no-date-overrides">
            Nema dodatih posebnih datuma.
          </p>
        ) : (
          <div className="space-y-3">
            {formData.dateHours.map((override, index) => (
              <article
                key={override.id ?? `${override.date}-${index}`}
                className="space-y-4 rounded-md border bg-muted/20 p-3 sm:p-4"
                data-testid={`card-date-override-${index}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="w-full space-y-2 sm:max-w-xs">
                    <Label htmlFor={`booking-override-date-${index}`}>Datum</Label>
                    <Input
                      id={`booking-override-date-${index}`}
                      data-testid={`input-date-override-${index}`}
                      type="date"
                      value={override.date}
                      onChange={event => {
                        const date = event.target.value;
                        if (formData.dateHours.some((item, itemIndex) => itemIndex !== index && item.date === date)) {
                          setDateHoursError("Posebno radno vreme za izabrani datum već postoji.");
                          return;
                        }
                        updateDateOverride(index, { date });
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="self-start text-destructive hover:text-destructive sm:ml-auto sm:self-auto"
                    data-testid={`button-remove-date-override-${index}`}
                    aria-label={`Ukloni posebno radno vreme za ${override.date}`}
                    onClick={() => removeDateOverride(index)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    Ukloni
                  </Button>
                </div>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Status tog dana</legend>
                  <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`booking-override-status-${index}`}
                        data-testid={`radio-date-closed-${index}`}
                        checked={override.closed}
                        onChange={() => updateDateOverride(index, {
                          closed: true,
                          openTime: null,
                          closeTime: null
                        })}
                      />
                      Zatvoreno ceo dan
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`booking-override-status-${index}`}
                        data-testid={`radio-date-custom-hours-${index}`}
                        checked={!override.closed}
                        onChange={() => updateDateOverride(index, {
                          closed: false,
                          openTime: override.openTime ?? "09:00",
                          closeTime: override.closeTime ?? "17:00"
                        })}
                      />
                      Posebno radno vreme
                    </label>
                  </div>
                </fieldset>

                {!override.closed && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`booking-override-open-${index}`}>Otvaranje</Label>
                      <Input
                        id={`booking-override-open-${index}`}
                        data-testid={`input-date-open-${index}`}
                        type="time"
                        required
                        value={override.openTime ?? ""}
                        onChange={event => updateDateOverride(index, { openTime: event.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`booking-override-close-${index}`}>Zatvaranje</Label>
                      <Input
                        id={`booking-override-close-${index}`}
                        data-testid={`input-date-close-${index}`}
                        type="time"
                        required
                        value={override.closeTime ?? ""}
                        onChange={event => updateDateOverride(index, { closeTime: event.target.value })}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor={`booking-override-reason-${index}`}>Razlog (opciono)</Label>
                  <Input
                    id={`booking-override-reason-${index}`}
                    data-testid={`input-date-reason-${index}`}
                    value={override.reason ?? ""}
                    placeholder="Na primer: državni praznik"
                    onChange={event => updateDateOverride(index, { reason: event.target.value || null })}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {saveError && (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

      <Button type="submit" data-testid="button-save-booking-settings" disabled={replaceSettings.isPending}>
        {replaceSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sačuvaj podešavanja
      </Button>
    </form>
  );
}
