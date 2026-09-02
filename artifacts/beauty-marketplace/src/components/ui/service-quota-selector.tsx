import { useState } from "react";
import { SearchableCombobox, type SearchableComboboxOption } from "@/components/ui/searchable-combobox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { Service } from "@workspace/api-client-react";

interface ServiceQuotaSelectorProps {
  services: Service[];
  quotas: Record<string, number>;
  onChange: (quotas: Record<string, number>) => void;
  testIdPrefix?: string;
}

export function ServiceQuotaSelector({ services, quotas, onChange, testIdPrefix = "service-quota" }: ServiceQuotaSelectorProps) {
  const [comboboxValue, setComboboxValue] = useState("");

  const activeServices = services.filter(s => s.active && !Object.prototype.hasOwnProperty.call(quotas, s.id));
  const options: SearchableComboboxOption[] = activeServices.map(s => ({
    value: s.id,
    label: s.name,
    keywords: s.name
  }));

  const handleAdd = (serviceId: string) => {
    if (!serviceId) return;
    onChange({ ...quotas, [serviceId]: 1 });
    setComboboxValue("");
  };

  const handleRemove = (serviceId: string) => {
    const newQuotas = { ...quotas };
    delete newQuotas[serviceId];
    onChange(newQuotas);
  };

  const handleChangeQuota = (serviceId: string, value: string) => {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) {
      onChange({ ...quotas, [serviceId]: parsed });
    }
  };

  return (
    <div className="min-w-0 max-w-full space-y-3 overflow-hidden">
      {Object.keys(quotas).length > 0 && (
        <div className="min-w-0 max-h-60 space-y-2 overflow-y-auto overflow-x-hidden pr-1">
          {Object.entries(quotas).map(([serviceId, quota]) => {
            const service = services.find(s => s.id === serviceId);
            if (!service) return null;
            return (
              <div key={serviceId} className="flex min-w-0 max-w-full flex-col gap-2 rounded-lg border bg-muted/20 p-2 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={service.name}>{service.name}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={quota}
                    onChange={(e) => handleChangeQuota(serviceId, e.target.value)}
                    className="w-20 h-9"
                    aria-label={`Kvota za ${service.name}`}
                    data-testid={`${testIdPrefix}-quota-${serviceId}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemove(serviceId)}
                    aria-label={`Ukloni ${service.name}`}
                    data-testid={`${testIdPrefix}-remove-${serviceId}`}
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <SearchableCombobox
        value={comboboxValue}
        onValueChange={handleAdd}
        options={options}
        placeholder="Dodaj uslugu..."
        searchPlaceholder="Pretraži usluge..."
        emptyMessage="Nema preostalih usluga."
        data-testid={`${testIdPrefix}-combobox`}
      />
    </div>
  );
}
