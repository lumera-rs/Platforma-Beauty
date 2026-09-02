import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetCurrentUser,
  useListSalonNotifications,
  useMarkSalonNotificationRead,
  type SalonNotification,
} from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { salonNotificationsQueryKey } from "@/lib/salon-notifications";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Bell, Check, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { rollbackQueries, updateMatchingQueriesOptimistically } from "@/lib/optimistic-query";
import { OWNER_NOTIFICATION_MUTATION_KEY, ownerNotificationMutationQueue, useMutationQueueBusy } from "@/lib/optimistic-mutation-queue";

function notificationDate(value: string) {
  return new Date(value).toLocaleString("sr-RS", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function OwnerNotifications() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const notificationMutationPending = useMutationQueueBusy(ownerNotificationMutationQueue);
  const { data: userResponse, isLoading: isUserLoading } = useGetCurrentUser();
  const user = userResponse?.user;
  const hasSalonNotificationContext = user?.role === "SALON_OWNER";
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const listParams = useMemo(() => ({ page, pageSize }), [page]);
  // Page is appended to the end of the shared owner-scoped key so prefix-based
  // invalidation (used by the navbar SSE refresh and mark-as-read) still matches
  // every page while keeping pages cached independently.
  const notificationsQueryKey = useMemo(() => [...salonNotificationsQueryKey(user?.id), page] as const, [user?.id, page]);
  const { data: notifications = [], isLoading, isError } = useListSalonNotifications(listParams, {
    query: { enabled: hasSalonNotificationContext, queryKey: notificationsQueryKey },
  });
  const hasNextPage = notifications.length === pageSize;
  const markAsRead = useMarkSalonNotificationRead({
    mutation: {
      mutationKey: OWNER_NOTIFICATION_MUTATION_KEY,
      onMutate: async ({ notificationId }) => {
        const release = await ownerNotificationMutationQueue.acquire();
        try {
          const snapshots = await updateMatchingQueriesOptimistically<SalonNotification[]>(
            queryClient,
            { queryKey: salonNotificationsQueryKey(user?.id) },
            (current) => current?.map((item) => item.id === notificationId
              ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
              : item),
          );
          return { snapshots, release };
        } catch (error) {
          release();
          throw error;
        }
      },
      onError: (_error, _variables, context) => {
        rollbackQueries(queryClient, context?.snapshots);
        toast.error("Obaveštenje nije ažurirano", { description: "Vraćeno je prethodno stanje. Pokušajte ponovo." });
      },
      onSettled: async (_data, _error, _variables, context) => {
        try {
          await queryClient.invalidateQueries({ queryKey: salonNotificationsQueryKey(user?.id) });
        } finally {
          context?.release();
        }
      },
    },
  });

  return (
    <BusinessLayout>
      <div className="container mx-auto flex flex-col gap-8 px-4 py-8 md:flex-row">
        <OwnerSidebar current="/vlasnik/obavestenja" />
        <main className="min-w-0 flex-1">
          <div className="mb-6">
            <h1 className="font-serif text-3xl font-bold">Obaveštenja</h1>
            <p className="text-muted-foreground">Važne promene i potvrde za vaše poslovanje.</p>
          </div>

          {isUserLoading || isLoading ? (
            <div className="flex justify-center p-12" data-testid="status-notifications-loading"><Loader2 className="h-7 w-7 animate-spin" /></div>
          ) : isError ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground" data-testid="status-notifications-error">Obaveštenja trenutno nisu dostupna. Pokušajte ponovo.</CardContent></Card>
          ) : notifications.length === 0 ? (
            <Card><CardContent className="p-10 text-center text-muted-foreground" data-testid="status-notifications-empty"><Bell className="mx-auto mb-3 h-8 w-8 opacity-30" />{page > 1 ? "Nema više obaveštenja." : "Nemate novih obaveštenja."}</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => {
                const unread = !notification.readAt;
                return (
                  <Card key={notification.id} className={unread ? "border-primary/30 bg-primary/5" : ""} data-testid={`notification-${notification.id}`}>
                    <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold" data-testid={`text-notification-title-${notification.id}`}>{notification.title}</h2>
                          {unread && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground" data-testid={`status-notification-unread-${notification.id}`}>Nepročitano</span>}
                        </div>
                        <p className="text-sm text-muted-foreground" data-testid={`text-notification-message-${notification.id}`}>{notification.message}</p>
                        <p className="mt-2 text-xs text-muted-foreground" data-testid={`text-notification-date-${notification.id}`}>{notificationDate(notification.createdAt)}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {notification.href && (
                          <Button asChild variant="outline" size="sm">
                            <Link href={notification.href} data-testid={`link-notification-target-${notification.id}`}>Detalji <ExternalLink className="ml-2 h-4 w-4" /></Link>
                          </Button>
                        )}
                        {unread && (
                          <Button
                            size="sm"
                            onClick={() => markAsRead.mutate({ notificationId: notification.id })}
                            disabled={notificationMutationPending}
                            data-testid={`button-mark-notification-read-${notification.id}`}
                          >
                            {notificationMutationPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                            Označi kao pročitano
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {!isUserLoading && !isLoading && !isError && (page > 1 || hasNextPage) && (
            <div className="flex items-center justify-between gap-3 pt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} data-testid="btn-prev-page">Prethodna</Button>
              <span className="text-sm text-muted-foreground">Strana {page}</span>
              <Button variant="outline" size="sm" disabled={!hasNextPage} onClick={() => setPage(p => p + 1)} data-testid="btn-next-page">Sledeća</Button>
            </div>
          )}
        </main>
      </div>
    </BusinessLayout>
  );
}