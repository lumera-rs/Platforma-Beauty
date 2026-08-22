import {
  getGetCustomerDashboardQueryKey,
  getListFavoritesQueryKey,
  useGetCurrentUser,
  useListFavorites,
  useToggleFavorite,
} from "@workspace/api-client-react";
import type { CustomerDashboard, SalonCard } from "@workspace/api-client-react";
import { Heart } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export function SalonFavoriteButton({ salon, className }: { salon: SalonCard; className?: string }) {
  const salonId = salon.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [optimisticFavorited, setOptimisticFavorited] = useState<boolean | null>(null);
  const [isInteractionPending, setIsInteractionPending] = useState(false);
  const { data: userResp } = useGetCurrentUser();
  const isCustomer = userResp?.user?.role === "CUSTOMER";
  const showFavoriteError = () => {
    toast.error("Favorit nije sačuvan", {
      id: `favorite-error-${salonId}`,
      description: "Pokušajte ponovo za trenutak.",
    });
  };
  const { data: favorites, isSuccess: areFavoritesReady } = useListFavorites({
    query: {
      enabled: isCustomer,
      queryKey: getListFavoritesQueryKey(),
    },
  });
  const favoritesKey = getListFavoritesQueryKey();
  const dashboardKey = getGetCustomerDashboardQueryKey();
  const toggleFavorite = useToggleFavorite({
    mutation: {
      // Optimistically flip favorited state before the server responds, keeping
      // a snapshot for rollback and reconciling with the server on settle.
      onMutate: async () => {
        await Promise.all([
          queryClient.cancelQueries({ queryKey: favoritesKey }),
          queryClient.cancelQueries({ queryKey: dashboardKey }),
        ]);
        const previousFavorites = queryClient.getQueryData<SalonCard[]>(favoritesKey);
        const previousDashboard = queryClient.getQueryData<CustomerDashboard>(dashboardKey);
        const currentFavorites = previousFavorites ?? favorites;
        if (!currentFavorites) {
          throw new Error("Favorites cache is not ready.");
        }
        const currentlyFavorited = currentFavorites.some((favorite) => favorite.id === salonId);

        queryClient.setQueryData<SalonCard[]>(favoritesKey, (current = currentFavorites) =>
          currentlyFavorited
            ? current.filter((favorite) => favorite.id !== salonId)
            : current.some((favorite) => favorite.id === salonId)
              ? current
              : [...current, salon],
        );
        queryClient.setQueryData<CustomerDashboard>(dashboardKey, (current) =>
          current
            ? { ...current, favoriteCount: Math.max(0, current.favoriteCount + (currentlyFavorited ? -1 : 1)) }
            : current,
        );

        return { previousFavorites, previousDashboard };
      },
      onError: (_error, _variables, context) => {
        if (context?.previousFavorites !== undefined) queryClient.setQueryData(favoritesKey, context.previousFavorites);
        if (context?.previousDashboard !== undefined) queryClient.setQueryData(dashboardKey, context.previousDashboard);
        setOptimisticFavorited(null);
        showFavoriteError();
      },
      onSuccess: (result) => {
        setOptimisticFavorited(result.favorited);
        toast.success(result.favorited ? "Salon je dodat u omiljene." : "Salon je uklonjen iz omiljenih.");
      },
      // Reconcile the local optimistic state with authoritative server data.
      onSettled: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: favoritesKey }),
          queryClient.invalidateQueries({ queryKey: dashboardKey }),
        ]);
        setOptimisticFavorited(null);
        setIsInteractionPending(false);
      },
    },
  });
  const isFavorited = optimisticFavorited ?? (favorites ?? []).some((favorite) => favorite.id === salonId);

  if (!isCustomer) return null;

  return (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      aria-label={isFavorited ? "Ukloni iz omiljenih salona" : "Dodaj u omiljene salone"}
      aria-pressed={isFavorited}
      disabled={!areFavoritesReady || favorites === undefined || isInteractionPending}
      data-pending={!areFavoritesReady || favorites === undefined || isInteractionPending}
      data-testid={`button-favorite-salon-${salonId}`}
      className={cn(
        "rounded-full bg-background/95 shadow-sm backdrop-blur hover:bg-background",
        isFavorited && "text-primary",
        className,
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // Guard against rapid repeated clicks while a toggle is in flight.
        if (!areFavoritesReady || favorites === undefined || isInteractionPending) return;
        setIsInteractionPending(true);
        setOptimisticFavorited(!isFavorited);
        void toggleFavorite
          .mutateAsync({ data: { salonId } })
          .catch(() => showFavoriteError());
      }}
    >
      <Heart className={cn("h-4 w-4", isFavorited && "fill-current")} />
    </Button>
  );
}
