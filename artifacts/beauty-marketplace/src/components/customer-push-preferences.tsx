import { useEffect, useState } from "react";
import { BellRing, CircleAlert, Loader2, Smartphone } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  deletePushSubscription,
  getPushConfig,
  listPushSubscriptions,
  toPushSubscriptionRequest,
  upsertPushSubscription,
  urlBase64ToUint8Array,
} from "@/lib/customer-push";

type PushState = "checking" | "unsupported" | "disabled" | "enabled";

function browserSupportsPush() {
  return window.isSecureContext
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

function permissionLabel(permission: NotificationPermission) {
  if (permission === "granted") return "Dozvola je odobrena";
  if (permission === "denied") return "Dozvola je blokirana u pregledaču";
  return "Dozvola još nije zatražena";
}

export function CustomerPushPreferences() {
  const [state, setState] = useState<PushState>("checking");
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let active = true;
    if (!browserSupportsPush()) {
      setState("unsupported");
      return;
    }
    setPermission(Notification.permission);
    void navigator.serviceWorker.ready
      .then(async (registration) => {
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return false;
        const savedSubscriptions = await listPushSubscriptions();
        const saved = savedSubscriptions.find((item) => item.endpoint === subscription.endpoint);
        if (!saved?.enabled) await subscription.unsubscribe().catch(() => false);
        return Boolean(saved?.enabled);
      })
      .then((enabled) => {
        if (active) setState(enabled ? "enabled" : "disabled");
      })
      .catch(() => {
        if (active) {
          setError("Status uređaja trenutno nije moguće proveriti.");
          setState("disabled");
        }
      });
    return () => { active = false; };
  }, []);

  const enable = async () => {
    setBusy(true);
    setError(null);
    let createdSubscription: PushSubscription | null = null;
    try {
      const config = await getPushConfig();
      if (!config.configured || !config.publicKey) throw new Error("Sistemska push obaveštenja trenutno nisu dostupna.");
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        throw new Error(nextPermission === "denied"
          ? "Dozvola je blokirana. Omogućite obaveštenja u podešavanjima pregledača."
          : "Bez dozvole pregledača nije moguće uključiti sistemska obaveštenja.");
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey),
        });
        createdSubscription = subscription;
      }
      await upsertPushSubscription(toPushSubscriptionRequest(subscription));
      setState("enabled");
      toast.success("Sistemska push obaveštenja su uključena.", {
        description: "Ovaj uređaj može da prima podsetnike i kada LUMERA nije otvorena.",
      });
    } catch (caught) {
      if (createdSubscription) await createdSubscription.unsubscribe().catch(() => false);
      const message = caught instanceof Error ? caught.message : "Pokušajte ponovo.";
      setError(message);
      toast.error("Push obaveštenja nisu uključena", { description: message });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const savedSubscriptions = await listPushSubscriptions();
        const saved = savedSubscriptions.find((item) => item.endpoint === subscription.endpoint);
        if (saved) await deletePushSubscription(saved.id);
        const unsubscribed = await subscription.unsubscribe();
        if (!unsubscribed) throw new Error("Pregledač nije uspeo da ukloni lokalnu pretplatu.");
      }
      setState("disabled");
      toast.success("Sistemska push obaveštenja su isključena na ovom uređaju.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Pokušajte ponovo.";
      setError(message);
      toast.error("Push obaveštenja nisu isključena", { description: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/20" data-testid="card-system-push-preferences">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2 text-primary"><Smartphone className="h-5 w-5" /></div>
          <div>
            <CardTitle>Sistemska push obaveštenja (i kada LUMERA nije otvorena)</CardTitle>
            <CardDescription className="mt-1">
              Dozvola važi samo za ovaj pregledač i uređaj. Drugi uređaji se podešavaju zasebno.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium" data-testid="status-system-push">
              {state === "checking" && "Proveravamo ovaj uređaj…"}
              {state === "enabled" && "Uključeno na ovom uređaju"}
              {state === "disabled" && "Isključeno na ovom uređaju"}
              {state === "unsupported" && "Nije podržano na ovom uređaju"}
            </p>
            {state !== "unsupported" && state !== "checking" && (
              <p className="mt-1 text-sm text-muted-foreground" data-testid="status-notification-permission">
                {permissionLabel(permission)}
              </p>
            )}
          </div>
          {state === "enabled" ? (
            <Button variant="outline" onClick={disable} disabled={busy} data-testid="button-disable-system-push">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Isključi na ovom uređaju
            </Button>
          ) : state === "disabled" ? (
            <Button onClick={enable} disabled={busy || permission === "denied"} data-testid="button-enable-system-push">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BellRing className="mr-2 h-4 w-4" />}
              Uključi na ovom uređaju
            </Button>
          ) : null}
        </div>
        {state === "unsupported" && (
          <Alert data-testid="alert-system-push-unsupported">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Sistemska obaveštenja nisu dostupna</AlertTitle>
            <AlertDescription>Koristite podržan pregledač preko bezbedne HTTPS veze. LUMERA obaveštenja u aplikaciji i dalje rade.</AlertDescription>
          </Alert>
        )}
        {state !== "unsupported" && permission === "denied" && (
          <Alert data-testid="alert-system-push-permission-denied">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Pregledač je blokirao obaveštenja</AlertTitle>
            <AlertDescription>
              Otvorite podešavanja dozvola za ovaj sajt, dozvolite obaveštenja, a zatim osvežite stranicu.
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" data-testid="alert-system-push-error">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Promena nije sačuvana</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="text-xs text-muted-foreground">
          Ovo podešavanje ne menja LUMERA obaveštenja u aplikaciji niti njihov status pročitanosti.
        </p>
      </CardContent>
    </Card>
  );
}