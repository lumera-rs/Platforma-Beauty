import { useCustomerListAftercareRecommendations, getCustomerListAftercareRecommendationsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function AftercarePreview() {
  const { data: recommendations, isLoading } = useCustomerListAftercareRecommendations({}, {
    query: {
      queryKey: getCustomerListAftercareRecommendationsQueryKey(),
    }
  });

  if (isLoading) {
    return (
      <section className="mb-8">
        <Skeleton className="h-32 w-full rounded-xl" />
      </section>
    );
  }

  const recommendation = recommendations?.[0];

  if (!recommendation) {
    return null;
  }

  const unread = !recommendation.readAt;

  return (
    <section className="mb-8">
      <div className="rounded-xl border bg-card p-6 shadow-sm overflow-hidden relative group">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 text-primary/5 transition-transform duration-700 group-hover:scale-110">
          <Sparkles className="w-64 h-64" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-primary mb-2">
            <Sparkles className="h-5 w-5" />
            <h2 className="font-serif text-xl font-bold">Preporučena nega</h2>
            {unread && (
              <span className="ml-2 flex h-2.5 w-2.5 rounded-full bg-primary" />
            )}
          </div>
          <p className="text-muted-foreground mb-6 max-w-2xl text-sm sm:text-base">
            Personalizovane preporuke za vaš oporavak nakon tretmana ({recommendation.treatments.join(", ")}). Pregledajte savete stručnjaka i odobrene proizvode.
          </p>
          <Button asChild variant={unread ? "default" : "outline"}>
            <Link href={`/moj-nalog/nega-posle-tretmana`}>
              Pogledajte preporuke <ArrowRight className="ml-2 w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
