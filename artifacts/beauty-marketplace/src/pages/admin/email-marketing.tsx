import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getAdminListEmailCampaignsQueryKey,
  useAdminCreateEmailCampaign,
  useAdminListEmailCampaigns,
  useAdminListLoyaltyTiers,
  type AdminCreateEmailCampaignInput,
} from "@workspace/api-client-react";
import { CalendarClock, Loader2, Mail, Send } from "lucide-react";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

const initial = {
  audience: "customers" as AdminCreateEmailCampaignInput["audience"],
  loyaltyTierId: "",
  title: "",
  subject: "",
  htmlContent: "<p>Poštovani,</p><p></p><p>Srdačno,<br/>LUMERA</p>",
  sendMode: "now" as AdminCreateEmailCampaignInput["sendMode"],
  scheduledAt: "",
};

export default function AdminEmailMarketing() {
  const [form, setForm] = useState(initial);
  const { data, isLoading } = useAdminListEmailCampaigns();
  const { data: tiers } = useAdminListLoyaltyTiers();
  const createCampaign = useAdminCreateEmailCampaign();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();

  const submit = () => {
    if (!actionGuard.begin("campaign-submit")) return;
    if (form.audience === "loyalty" && !form.loyaltyTierId) {
      toast.error("Izaberite loyalty nivo", { description: "Ova publika zahteva konkretan nivo." });
      actionGuard.end("campaign-submit");
      return;
    }
    const scheduledAt = form.sendMode === "scheduled" && form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null;
    createCampaign.mutate({
      data: {
        audience: form.audience,
        loyaltyTierId: form.audience === "loyalty" ? form.loyaltyTierId : null,
        title: form.title,
        subject: form.subject,
        htmlContent: form.htmlContent,
        sendMode: form.sendMode,
        scheduledAt,
      },
    }, {
      onSuccess: (campaign) => {
        toast.success(form.sendMode === "now" ? "Kampanja je poslata" : "Kampanja je zakazana", {
          description: `Publika: ${campaign.recipientCount} primaoca.`,
        });
        queryClient.invalidateQueries({ queryKey: getAdminListEmailCampaignsQueryKey() });
        setForm(initial);
        actionGuard.end("campaign-submit");
      },
      onError: () => {
        toast.error("Kampanja nije poslata", { description: "Proverite Brevo sender podešavanje i sadržaj." });
        actionGuard.end("campaign-submit");
      },
    });
  };

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="font-serif text-3xl font-bold">E-mail marketing</h1>
          <p className="mt-2 text-muted-foreground">Kreirajte Brevo kampanju za klijente, salone ili loyalty segment.</p>
        </div>
        <div className="grid gap-7 xl:grid-cols-[1.2fr_.8fr]">
          <section className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2 font-semibold"><Mail className="h-5 w-5 text-primary" /> Nova kampanja</div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2"><Label>Publika</Label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value as typeof form.audience })}>
                  <option value="customers">Svi klijenti</option><option value="salons">Svi saloni</option><option value="loyalty">Saloni po loyalty nivou</option>
                </select>
              </div>
              {form.audience === "loyalty" && <div className="space-y-2"><Label>Loyalty nivo</Label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.loyaltyTierId} onChange={(event) => setForm({ ...form, loyaltyTierId: event.target.value })}>
                  <option value="">Izaberite nivo</option>{tiers?.map((tier) => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
                </select>
              </div>}
            </div>
            <div className="space-y-2"><Label>Naziv kampanje</Label><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="npr. Jesenja nega kože" /></div>
            <div className="space-y-2"><Label>Naslov e-maila</Label><Input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="Posebna ponuda za vas" /></div>
            <div className="space-y-2"><Label>HTML sadržaj</Label><Textarea className="min-h-56 font-mono text-xs" value={form.htmlContent} onChange={(event) => setForm({ ...form, htmlContent: event.target.value })} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Slanje</Label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.sendMode} onChange={(event) => setForm({ ...form, sendMode: event.target.value as typeof form.sendMode })}>
                  <option value="now">Pošalji odmah</option><option value="scheduled">Zakaži slanje</option>
                </select>
              </div>
              {form.sendMode === "scheduled" && <div className="space-y-2"><Label>Datum i vreme</Label><Input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })} /></div>}
            </div>
            <Button className="w-full sm:w-auto" onClick={submit} disabled={createCampaign.isPending || actionGuard.isActive("campaign-submit")}>
              {createCampaign.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : form.sendMode === "now" ? <Send className="mr-2 h-4 w-4" /> : <CalendarClock className="mr-2 h-4 w-4" />}
              {form.sendMode === "now" ? "Pošalji kampanju" : "Zakaži kampanju"}
            </Button>
          </section>
          <section className="rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="font-semibold">Pregled HTML sadržaja</h2>
            <div className="mt-4 min-h-80 overflow-auto rounded-lg border bg-white p-5 text-sm text-black" dangerouslySetInnerHTML={{ __html: form.htmlContent }} />
          </section>
        </div>
        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="border-b px-6 py-4"><h2 className="font-semibold">Istorija kampanja</h2></div>
          {isLoading ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div> : data?.campaigns.length ? (
            <div className="divide-y">{data.campaigns.map((campaign) => <div key={campaign.id} className="flex flex-col gap-2 px-6 py-4 md:flex-row md:items-center md:justify-between">
              <div><p className="font-medium">{campaign.title}</p><p className="text-sm text-muted-foreground">{campaign.subject} · {campaign.recipientCount} primaoca</p></div>
              <div className="text-sm"><span className="rounded-full bg-muted px-2 py-1">{campaign.status}</span>{campaign.scheduledAt && <span className="ml-2 text-muted-foreground">{new Date(campaign.scheduledAt).toLocaleString("sr-RS")}</span>}{campaign.errorMessage && <p className="mt-1 text-destructive">{campaign.errorMessage}</p>}</div>
            </div>)}</div>
          ) : <p className="p-10 text-center text-muted-foreground">Još nema kreiranih kampanja.</p>}
        </section>
      </div>
    </AdminLayout>
  );
}