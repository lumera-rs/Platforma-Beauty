import { useState } from "react";
import { useAdminListOrders, useAdminUpdateOrderStatus, getAdminListOrdersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "./layout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

const statuses = ["pending", "confirmed", "paid", "processing", "shipped", "delivered", "cancelled"] as const;
export default function AdminOrders() {
 const [search, setSearch] = useState(""); const [status, setStatus] = useState<string>("all"); const params = { ...(search ? { search } : {}), ...(status !== "all" ? { status: status as typeof statuses[number] } : {}) }; const {data: orders = [], isLoading} = useAdminListOrders(params); const qc = useQueryClient(); const update = useAdminUpdateOrderStatus({ mutation: { onSuccess: () => qc.invalidateQueries({queryKey: getAdminListOrdersQueryKey(params)}) }});
 return <AdminLayout><h1 className="text-3xl font-serif font-bold mb-5">B2B porudžbine</h1><div className="flex gap-3 mb-5"><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pretraga salona, primaoca ili broja"/><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-48"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Svi statusi</SelectItem>{statuses.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>{isLoading ? <Loader2 className="animate-spin"/> : <div className="space-y-3">{orders.map(o=><Card key={o.id}><CardContent className="p-4 flex flex-wrap gap-3 items-center justify-between"><div><b>#{o.id.slice(0,8)} · {o.salon.name}</b><p className="text-sm text-muted-foreground">{o.delivery.recipientName} · {new Date(o.createdAt).toLocaleDateString("sr-RS")}</p></div><Badge>{o.status}</Badge><b>{o.total.toLocaleString("sr-RS")} RSD</b><Select value={o.status} onValueChange={value=>update.mutate({orderId:o.id,data:{status:value as "confirmed"|"shipped"|"delivered"|"cancelled"}})}><SelectTrigger className="w-36"><SelectValue/></SelectTrigger><SelectContent>{["confirmed","shipped","delivered","cancelled"].map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></CardContent></Card>)}</div>}</AdminLayout>;
}