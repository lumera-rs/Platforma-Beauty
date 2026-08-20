import { useAdminListSmsDeliveries } from "@workspace/api-client-react";
import { Loader2, MessageSquareText } from "lucide-react";
import { AdminLayout } from "./layout";
import { Badge } from "@/components/ui/badge";

const labels = { appointment_confirmation: "Potvrda termina", appointment_reminder: "Podsetnik" };

export default function AdminSmsDeliveries() {
  const { data, isLoading } = useAdminListSmsDeliveries();
  return <AdminLayout>
    <div className="space-y-6">
      <div><h1 className="font-serif text-3xl font-bold">SMS evidencija</h1><p className="mt-2 text-muted-foreground">Transakcione potvrde i podsetnici. Brojevi su maskirani radi privatnosti.</p></div>
      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b px-6 py-4 font-semibold"><MessageSquareText className="h-5 w-5 text-primary" /> Istorija isporuke</div>
        {isLoading ? <div className="flex justify-center p-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div> : data?.length ? <div className="divide-y">{data.map((delivery) => <div key={delivery.id} className="grid gap-2 px-6 py-4 text-sm md:grid-cols-[1fr_.8fr_.7fr_.6fr] md:items-center"><div><p className="font-medium">{labels[delivery.messageType]}</p><p className="text-muted-foreground">{delivery.salonName ?? "Obrisani salon"} · {new Date(delivery.createdAt).toLocaleString("sr-RS")}</p></div><p className="font-mono text-muted-foreground">{delivery.recipientPhone}</p><Badge className="w-fit" variant={delivery.status === "sent" ? "default" : delivery.status === "failed" ? "destructive" : "secondary"}>{delivery.status}</Badge><p className="text-xs text-destructive">{delivery.errorMessage ?? ""}</p></div>)}</div> : <p className="p-12 text-center text-muted-foreground">Još nema SMS zapisa.</p>}
      </section>
    </div>
  </AdminLayout>;
}