import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchableMultiSelectOption = {
  value: string;
  label: string;
  keywords?: string;
};

type SearchableMultiSelectProps = {
  value: string[];
  onValueChange: (value: string[]) => void;
  options: SearchableMultiSelectOption[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  maxSelected?: number;
  "aria-label"?: string;
  "data-testid"?: string;
};

export function SearchableMultiSelect({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder = "Pretražite proizvode...",
  emptyMessage = "Nema dostupnih proizvoda.",
  disabled = false,
  maxSelected,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("sr-RS");
  const selectedOptions = value
    .map((selectedValue) => options.find((option) => option.value === selectedValue))
    .filter((option): option is SearchableMultiSelectOption => Boolean(option));
  const filteredOptions = options.filter((option) =>
    `${option.label} ${option.keywords ?? ""}`.toLocaleLowerCase("sr-RS").includes(normalizedQuery),
  );

  const toggle = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onValueChange(value.filter((current) => current !== optionValue));
    } else if (maxSelected == null || value.length < maxSelected) {
      onValueChange([...value, optionValue]);
    }
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel ?? placeholder}
            disabled={disabled}
            data-testid={testId}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
              {value.length > 0 ? `Izabrano: ${value.length}` : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command shouldFilter={false}>
            <CommandInput value={query} onValueChange={setQuery} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
            <CommandList aria-label={ariaLabel ?? placeholder}>
              {filteredOptions.length === 0 ? <CommandEmpty>{emptyMessage}</CommandEmpty> : filteredOptions.map((option) => {
                const selected = value.includes(option.value);
                const limitReached = !selected && maxSelected != null && value.length >= maxSelected;
                return (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    disabled={limitReached}
                    onSelect={() => toggle(option.value)}
                    data-testid={testId ? `${testId}-option-${option.value}` : undefined}
                  >
                    <Check className={cn("h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Izabrani proizvodi">
          {selectedOptions.map((option) => (
            <Badge key={option.value} variant="secondary" className="max-w-full gap-1 pl-2">
              <span className="truncate">{option.label}</span>
              <button
                type="button"
                onClick={() => onValueChange(value.filter((current) => current !== option.value))}
                aria-label={`Ukloni ${option.label}`}
                data-testid={testId ? `${testId}-remove-${option.value}` : undefined}
                className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}