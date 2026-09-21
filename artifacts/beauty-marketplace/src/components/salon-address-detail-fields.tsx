import { Input } from "@/components/ui/input";

export const emptyAddressDetails = { entranceDirections: "", intercom: "", floor: "", apartment: "" };
export type AddressDetails = typeof emptyAddressDetails;

export function SalonAddressDetailFields({ value, onChange }: {
  value: AddressDetails;
  onChange: (value: AddressDetails) => void;
}) {
  return <div className="grid gap-3 sm:grid-cols-2">
    {([
      ["entranceDirections", "Uputstvo za ulaz", "npr. ulaz sa bočne strane", 500],
      ["intercom", "Interfon", "npr. 22 enter", 80],
      ["floor", "Sprat", "npr. IV sprat ili prizemlje", 80],
      ["apartment", "Stan", "npr. 22", 40],
    ] as const).map(([key, label, placeholder, maxLength]) => <div key={key} className="space-y-1">
      <label htmlFor={`salon-${key}`} className="text-sm font-medium">{label} (opciono)</label>
      <Input id={`salon-${key}`} value={value[key]} placeholder={placeholder} maxLength={maxLength}
        onChange={(event) => onChange({ ...value, [key]: event.target.value })} />
    </div>)}
  </div>;
}