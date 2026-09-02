import { useState } from "react";
import { BriefcaseBusiness, Building2, Loader2, UserRoundSearch } from "lucide-react";
import { useLocation } from "wouter";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { beautyJobCreationPathForRole } from "@/lib/role-routing";

type CreateListingCtaProps = Omit<ButtonProps, "asChild" | "onClick">;

export function CreateListingCta({
  children = (
    <>
      <BriefcaseBusiness className="h-4 w-4" />
      Objavite oglas
    </>
  ),
  disabled,
  ...buttonProps
}: CreateListingCtaProps) {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetCurrentUser();
  const [choiceOpen, setChoiceOpen] = useState(false);

  const handleClick = () => {
    if (isLoading) return;
    if (data?.user) {
      setLocation(beautyJobCreationPathForRole(data.user.role));
      return;
    }
    setChoiceOpen(true);
  };

  const choose = (path: string) => {
    setChoiceOpen(false);
    setLocation(path);
  };

  return (
    <>
      <Button
        type="button"
        onClick={handleClick}
        disabled={disabled || isLoading}
        {...buttonProps}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
      </Button>

      <Dialog open={choiceOpen} onOpenChange={setChoiceOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Ko objavljuje oglas?</DialogTitle>
            <DialogDescription>
              Izaberite tip naloga da bismo vas odveli na odgovarajuću registraciju.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start gap-4 p-4 text-left"
              onClick={() => choose("/poslovna-registracija")}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-semibold">Salon / biznis</span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  Salon, wellness ili edukativni centar
                </span>
              </span>
            </Button>

            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start gap-4 p-4 text-left"
              onClick={() => choose("/pridruzi-se-poslovi")}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <UserRoundSearch className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-semibold">Tražim posao ili prostor</span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  Individualni JOBSEEKER nalog
                </span>
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}