import {
  getGetCustomerDashboardQueryKey,
  getListFavoritesQueryKey,
  type CustomerDashboard,
  type SalonCard,
  useGetCurrentUser,
  useListFavorites,
  useToggleFavorite,
} from "@workspace/api-client-react";
import { Heart } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { rollbackQueries, updateQueryOptimistically } from "@/lib/optimistic-query";
import { FAVORITE_MUTATION_KEY, favoriteMutationQueue, useMutationQueueBusy } from "@/lib/optimistic-mutation-queue";
import { updateOptimisticFavorites } from "@/lib/optimistic-favorite";

export function SalonFavoriteButton({
  salon,
  className,
}: {
  salon: SalonCard;
  className?: string;
}) {
  const salonId = salon.id;
  const queryClient = useQueryClient();
  const favoriteMutationPending = useMutationQueueBusy(favoriteMutationQueue);
  const { toast } = useToast();
  const { data: userResp } = useGetCurrentUser();
  const isCustomer = userResp?.user?.role === "CUSTOMER";
  const { data: favorites = [] } = useListFavorites({
    query: {
      enabled: isCustomer,
      queryKey: getListFavoritesQueryKey(),
    },
  });
  const serverIsFavorited = favorites.some((salon) => salon.id === salonId);
  const [optimisticFavorited, setOptimisticFavorited] = useState<boolean | null>(null);
  const isFavorited = optimisticFavorited ?? serverIsFavorited;
  const toggleFavorite = useToggleFavorite({
    mutation: {
      mutationKey: FAVORITE_MUTATION_KEY,
      onMutate: async () => {
        const release = await favoriteMutationQueue.acquire();
        const snapshots = [];
        try {
          const cachedFavorites = queryClient.getQueryData<SalonCard[]>(getListFavoritesQueryKey()) ?? favorites;
          const nextFavorited = !cachedFavorites.some((item) => item.id === salonId);
          setOptimisticFavorited(nextFavorited);
          snapshots.push(await updateQueryOptimistically<SalonCard[]>(
            queryClient,
            getListFavoritesQueryKey(),
            (current) => updateOptimisticFavorites(current, salon, nextFavorited),
          ));
          snapshots.push(await updateQueryOptimistically<CustomerDashboard>(
            queryClient,
            getGetCustomerDashboardQueryKey(),
            (current) => current ? {
              ...current,
              favoriteCount: Math.max(0, current.favoriteCount + (nextFavorited ? 1 : -1)),
            } : current,
          ));
          return { snapshots, release };
        } catch (error) {
          rollbackQueries(queryClient, snapshots);
          release();
          throw error;
        }
      },
      onSuccess: (result) => {
        setOptimisticFavorited(result.favorited);
        toast.success(result.favorited ? "Salon je dodat u omiljene." : "Salon je uklonjen iz omiljenih.");
      },
      onError: (_error, _variables, context) => {
        rollbackQueries(queryClient, context?.snapshots);
        setOptimisticFavorited(null);
        toast.error("Favorit nije sačuvan", { description: "Pokušajte ponovo za trenutak." });
      },
      onSettled: async (_data, _error, _variables, context) => {
        try {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getListFavoritesQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetCustomerDashboardQueryKey() }),
          ]);
          setOptimisticFavorited(null);
        } finally {
          context?.release();
        }
      },
    },
  });

  if (!isCustomer) return null;

  return (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      aria-label={isFavorited ? "Ukloni iz omiljenih salona" : "Dodaj u omiljene salone"}
      aria-pressed={isFavorited}
      data-testid={`button-favorite-${salonId}`}
      data-favorited={isFavorited ? "true" : "false"}
      disabled={favoriteMutationPending}
      className={cn(
        "rounded-full bg-background/95 shadow-sm backdrop-blur hover:bg-background",
        isFavorited && "text-primary",
        className,
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (favoriteMutationQueue.isBusy()) return;
        setOptimisticFavorited(!isFavorited);
        toggleFavorite.mutate({ data: { salonId } });
      }}
    >
      <Heart className={cn("h-4 w-4", isFavorited && "fill-current")} />
    </Button>
  );
}