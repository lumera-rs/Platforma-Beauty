import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle, RotateCcw, Box } from "lucide-react";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useListCustomerRetailOrders, useRepeatLastRetailOrder, getListCustomerRetailOrdersQueryKey } from "@workspace/api-client-react";

export function CustomerRetailOrders() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [repeatIdempotencyKey, setRepeatIdempotencyKey] = useState(() => crypto.randomUUID());
  
  const { data: orders, isLoading, isError, isFetching, refetch } = useListCustomerRetailOrders({
    query: { queryKey: getListCustomerRetailOrdersQueryKey(), retry: 1 },
  });

  const repeatOrder = useRepeatLastRetailOrder({
    request: { headers: { "Idempotency-Key": repeatIdempotencyKey } },
    mutation: {
      onSuccess: (data) => {
        setRepeatIdempotencyKey(crypto.randomUUID());
        toast.success(`Porudžbina ponovljena. Dodato ${data.added?.length || 0} stavki u korpu.`);
        setLocation("/korpa");
      },
      onError: (err) => toast.error("Nije moguće ponoviti porudžbinu.")
    }
  });

  if (isLoading) return <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  
  if (isError) return (
    <Empty className="border border-destructive/30 bg-card py-14" data-testid="retail-orders-error">
      <EmptyHeader>
        <EmptyMedia variant="icon"><AlertTriangle /></EmptyMedia>
        <EmptyTitle>Porudžbine trenutno nisu dostupne</EmptyTitle>
        <EmptyDescription>Nismo uspeli da učitamo istoriju retail porudžbina. Vaši podaci nisu izgubljeni — pokušajte ponovo.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" variant="outline" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
          Pokušaj ponovo
        </Button>
      </EmptyContent>
    </Empty>
  );

  if (!orders?.length) return (
    <Empty className="border bg-card py-14">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Box /></EmptyMedia>
        <EmptyTitle>Nemate retail porudžbine</EmptyTitle>
        <EmptyDescription>Proizvode za kućnu negu možete poručiti iz javne prodavnice.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild><Link href="/proizvodi">Istraži proizvode</Link></Button>
      </EmptyContent>
    </Empty>
  );

  return (
    <div className="space-y-3">
      {orders.map((order) => (
        <Card key={order.id}>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{order.orderNumber}</p>
              <p className="text-sm text-muted-foreground">
                {new Date(order.createdAt).toLocaleDateString("sr-RS")} · {order.items.map((item) => `${item.quantity}× ${item.name}`).join(", ")}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 text-right">
              <div className="flex items-center gap-2">
                <Badge variant={order.status === 'DELIVERED' ? 'outline' : 'secondary'}>{order.status}</Badge>
                <span className="font-semibold text-primary">{order.total.toLocaleString("sr-RS")} RSD</span>
              </div>
              <Button size="sm" variant="secondary" onClick={() => repeatOrder.mutate()} disabled={repeatOrder.isPending}>
                Ponovi porudžbinu
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}