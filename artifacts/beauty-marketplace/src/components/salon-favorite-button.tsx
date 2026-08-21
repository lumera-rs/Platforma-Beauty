import {
  getGetCustomerDashboardQueryKey,
  getListFavoritesQueryKey,
  useGetCurrentUser,
  useListFavorites,
  useToggleFavorite,
} from "@workspace/api-client-react";
import { Heart } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export function SalonFavoriteButton({ salonId, className }: { salonId: string; className?: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: userResp } = useGetCurrentUser();
  const isCustomer = userResp?.user?.role === "CUSTOMER";
  const { data: favorites = [] } = useListFavorites({
    query: {
      enabled: isCustomer,
      queryKey: getListFavoritesQueryKey(),
    },
  });
  const toggleFavorite = useToggleFavorite();
  const isFavorited = favorites.some((salon) => salon.id === salonId);

  if (!isCustomer) return null;

  return (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      aria-label={isFavorited ? "Ukloni iz omiljenih salona" : "Dodaj u omiljene salone"}
      aria-pressed={isFavorited}
      disabled={toggleFavorite.isPending}
      className={cn(
        "rounded-full bg-background/95 shadow-sm backdrop-blur hover:bg-background",
        isFavorited && "text-primary",
        className,
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleFavorite.mutate(
          { data: { salonId } },
          {
            onSuccess: (result) => {
              queryClient.invalidateQueries({ queryKey: getListFavoritesQueryKey() });
              queryClient.invalidateQueries({ queryKey: getGetCustomerDashboardQueryKey() });
              toast.success(result.favorited ? "Salon je dodat u omiljene." : "Salon je uklonjen iz omiljenih.");
            },
            onError: () => {
              toast.error("Favorit nije sačuvan", { description: "Pokušajte ponovo za trenutak." });
            },
          },
        );
      }}
    >
      <Heart className={cn("h-4 w-4", isFavorited && "fill-current")} />
    </Button>
  );
}