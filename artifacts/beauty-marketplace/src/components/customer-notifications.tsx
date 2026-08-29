import { Button } from "@/components/ui/button";
import { useListCustomerNotifications, useMarkCustomerNotificationRead, useMarkAllCustomerNotificationsRead, getListCustomerNotificationsQueryKey, getApiErrorMessage } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { Bell, Check, ExternalLink, Loader2, Circle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";

export function CustomerNotifications() {
  const { data: notifications, isLoading, refetch, isFetching } = useListCustomerNotifications(
    { limit: 20 },
    { query: { queryKey: getListCustomerNotificationsQueryKey({ limit: 20 }) } }
  );

  const markRead = useMarkCustomerNotificationRead();
  const markAllRead = useMarkAllCustomerNotificationsRead();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const handleMarkRead = (id: string) => {
    markRead.mutate({ notificationId: id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCustomerNotificationsQueryKey() });
      }
    });
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined, {
      onSuccess: () => {
        toast.success("Sva obaveštenja označena kao pročitana.");
        queryClient.invalidateQueries({ queryKey: getListCustomerNotificationsQueryKey() });
      },
      onError: (err) => {
        toast.error("Greška", { description: getApiErrorMessage(err, "Pokušajte ponovo.") });
      }
    });
  };

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const items = notifications?.items || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-card p-4 rounded-xl border">
        <div>
          <h2 className="text-lg font-bold">Obaveštenja</h2>
          <p className="text-sm text-muted-foreground">Ostanite u toku sa Vašim terminima</p>
        </div>
        {items.some(n => !n.readAt) && (
          <Button variant="outline" size="sm" onClick={handleMarkAllRead} disabled={markAllRead.isPending}>
            {markAllRead.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Označi sve kao pročitano
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-center p-12 bg-card border rounded-xl">
          <Bell className="mx-auto h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="font-semibold text-lg text-foreground">Nemate obaveštenja</p>
          <p className="text-sm text-muted-foreground mt-1">Vaša nova obaveštenja će se pojaviti ovde.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(notification => (
            <div
              key={notification.id}
              className={`p-4 rounded-xl border flex gap-4 transition-colors ${!notification.readAt ? 'bg-primary/5 border-primary/20' : 'bg-card'}`}
            >
              <div className="shrink-0 mt-1">
                {!notification.readAt ? (
                  <Circle className="h-4 w-4 fill-primary text-primary" />
                ) : (
                  <Bell className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1">
                  <h4 className={`text-sm ${!notification.readAt ? 'font-bold' : 'font-medium text-foreground/80'}`}>
                    {notification.title}
                  </h4>
                  <span className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">
                    {format(parseISO(notification.createdAt), 'dd.MM.yyyy. HH:mm')}
                  </span>
                </div>
                <p className={`text-sm ${!notification.readAt ? 'text-foreground/90' : 'text-muted-foreground'} whitespace-pre-wrap`}>
                  {notification.body}
                </p>
                {notification.deepLink && (
                  <Button variant="link" size="sm" className="px-0 h-auto mt-2" onClick={(e) => {
                    e.preventDefault();
                    if (!notification.readAt) {
                      markRead.mutate({ notificationId: notification.id }, {
                        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListCustomerNotificationsQueryKey() })
                      });
                    }
                    setLocation(notification.deepLink!);
                  }}>
                    Pogledaj detalje <ExternalLink className="ml-1 h-3 w-3" />
                  </Button>
                )}
              </div>
              {!notification.readAt && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 rounded-full h-8 w-8 hover:bg-primary/10 hover:text-primary"
                  onClick={() => handleMarkRead(notification.id)}
                  title="Označi kao pročitano"
                >
                  <Check className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {false && (
        <div className="pt-4 flex justify-center">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Učitaj još
          </Button>
        </div>
      )}
    </div>
  );
}
