import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchableComboboxOption = {
  value: string;
  label: string;
  keywords?: string;
};

type SearchableComboboxProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableComboboxOption[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  clearable?: boolean;
  pinnedAction?: { label: string; value: string };
  footer?: React.ReactNode;
  "data-testid"?: string;
  "aria-label"?: string;
};

export function SearchableCombobox({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder = "Pretražite...",
  emptyMessage = "Nema rezultata.",
  disabled = false,
  clearable = false,
  pinnedAction,
  footer,
  "data-testid": testId,
  "aria-label": ariaLabel,
}: SearchableComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value)
    ?? (pinnedAction?.value === value ? pinnedAction : undefined);
  const normalizedQuery = query.trim().toLocaleLowerCase("sr-RS");
  const filteredOptions = options.filter((option) =>
    `${option.label} ${option.keywords ?? ""}`.toLocaleLowerCase("sr-RS").includes(normalizedQuery),
  );

  const select = (nextValue: string) => {
    onValueChange(nextValue);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative min-w-0 max-w-full">
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            role="combobox"
            aria-label={ariaLabel ?? placeholder}
            aria-expanded={open}
            disabled={disabled}
            data-testid={testId}
            className="min-w-0 max-w-full justify-between overflow-hidden font-normal"
          >
            <span className={cn("min-w-0 flex-1 truncate text-left", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        {clearable && value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Poništi izbor"
            data-testid={testId ? `${testId}-clear` : undefined}
            className="absolute right-7 top-0 h-10 w-8"
            onClick={() => onValueChange("")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            data-testid={testId ? `${testId}-search` : undefined}
          />
          <CommandList aria-label={ariaLabel ?? placeholder}>
            {pinnedAction && (
              <CommandItem
                value={`action-${pinnedAction.value}`}
                keywords={[pinnedAction.label]}
                onSelect={() => select(pinnedAction.value)}
                className="border-b font-medium text-primary"
                data-testid={testId ? `${testId}-action` : undefined}
              >
                <Check className={cn("h-4 w-4", value === pinnedAction.value ? "opacity-100" : "opacity-0")} />
                {pinnedAction.label}
              </CommandItem>
            )}
            {filteredOptions.length === 0 ? (
              <CommandEmpty>{emptyMessage}</CommandEmpty>
            ) : (
              filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  keywords={[option.keywords ?? ""]}
                  onSelect={() => select(option.value)}
                  data-testid={testId ? `${testId}-option-${option.value}` : undefined}
                >
                  <Check className={cn("h-4 w-4", value === option.value ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </CommandItem>
              ))
            )}
          </CommandList>
          {footer && <div className="border-t p-2">{footer}</div>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}