import { useState, useRef, useEffect } from "react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { 
  useOwnerAskGrowthAi,
  useOwnerCreateAutomationFromAiProposal,
  useGetCurrentUser,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Sparkles, Send, MessageSquare, Plus, ArrowRight, X, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";

export default function OwnerAiAssistant() {
  const { data: userResp } = useGetCurrentUser();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [question, setQuestion] = useState("");
  const askMutation = useOwnerAskGrowthAi();
  const createDraftMutation = useOwnerCreateAutomationFromAiProposal();

  const [history, setHistory] = useState<{ q: string, a: any, isError?: boolean }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [proposalDraft, setProposalDraft] = useState<any>(null);

  const suggestedQuestions = [
    "Koji klijenti nisu bili duže od 60 dana, a imaju najveću potrošnju?",
    "Kako da povećam rebooking rate za tretmane lica?",
    "Koji je najprofitabilniji dan u nedelji i kako da popunim ostale?",
    "Predloži automatizaciju za rođendane mojih VIP klijenata."
  ];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  const handleAsk = (q: string) => {
    if (!q.trim()) return;
    setQuestion("");
    setHistory(prev => [...prev, { q, a: null }]); // null means loading

    askMutation.mutate({ data: { question: q } }, {
      onSuccess: (data) => {
        setHistory(prev => {
          const newHistory = [...prev];
          newHistory[newHistory.length - 1].a = data;
          return newHistory;
        });
      },
      onError: () => {
        setHistory(prev => {
          const newHistory = [...prev];
          newHistory[newHistory.length - 1].isError = true;
          return newHistory;
        });
        toast.error("Greška u komunikaciji sa AI asistentom.");
      }
    });
  };

  const handleOpenDraft = (context: string) => {
    // In a real scenario we'd parse the proposal, but for this demo let's set some defaults
    setProposalDraft({
      name: "AI Predlog Kampanje",
      trigger: "inactive_days",
      triggerConfig: { inactiveDays: 60 },
      action: "send_email",
      emailSubject: "Nedostajete nam",
      emailBody: "Zdravo {{firstName}}, dugo se nismo videli. Imamo posebno iznenađenje za vas.",
      smsBody: "",
      voucherCode: "POVRATAK10",
      aiProposalContext: context
    });
  };

  const handleCreateDraft = () => {
    if (!proposalDraft) return;
    
    createDraftMutation.mutate({ data: proposalDraft }, {
      onSuccess: () => {
        toast.success("Kampanja je uspešno kreirana u stanju 'Pauzirano'.");
        setProposalDraft(null);
        setLocation("/vlasnik/automatizacije");
      },
      onError: (err: any) => {
        toast.error(err.message || "Greška pri kreiranju kampanje.");
      }
    });
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start h-[calc(100vh-120px)] min-h-[600px]">
        <OwnerSidebar current="/vlasnik/ai-asistent" />
        
        <div className="flex-1 flex flex-col w-full h-full min-h-0 bg-card border rounded-2xl shadow-sm overflow-hidden relative">
          <div className="p-4 border-b bg-muted/20 shrink-0">
            <h1 className="text-xl font-serif font-bold text-foreground flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-500" /> AI Asistent za Rast
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Vaš lični analitičar i marketing savetnik. Podaci su sveži i odnose se isključivo na vaš salon.</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar" ref={scrollRef}>
            {history.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-6">
                <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-indigo-500" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Kako vam mogu pomoći danas?</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Analiziram vaše podatke o klijentima, prihodu i performansama tima kako bih vam dao konkretne predloge za rast.
                  </p>
                </div>
                <div className="w-full space-y-2 text-left">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 text-center">Predložena pitanja</p>
                  {suggestedQuestions.map((sq, i) => (
                    <button 
                      key={i} 
                      onClick={() => handleAsk(sq)}
                      className="w-full text-left p-3 text-sm rounded-xl border bg-background hover:bg-muted hover:border-primary/30 transition-colors shadow-sm"
                    >
                      {sq}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              history.map((item, idx) => (
                <div key={idx} className="space-y-4">
                  {/* User Question */}
                  <div className="flex justify-end">
                    <div className="bg-primary text-primary-foreground px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[80%] shadow-sm">
                      <p className="text-sm">{item.q}</p>
                    </div>
                  </div>

                  {/* AI Answer */}
                  <div className="flex justify-start">
                    <div className="bg-muted/40 border px-4 py-3 rounded-2xl rounded-tl-sm max-w-[85%] shadow-sm">
                      {!item.a && !item.isError ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-500" /> Analiziram podatke salona...
                        </div>
                      ) : item.isError ? (
                        <div className="flex items-center gap-2 text-sm text-destructive py-1">
                          <AlertCircle className="w-4 h-4" /> Došlo je do greške u analizi. Pokušajte ponovo.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="text-sm whitespace-pre-wrap leading-relaxed max-w-none">
                            {item.a.answer}
                          </div>
                          
                          {/* Render Snapshot Data optionally */}
                          {item.a.snapshot && (
                            <details className="text-xs border rounded-lg p-2 bg-background mt-3 cursor-pointer group">
                              <summary className="font-semibold text-muted-foreground hover:text-foreground list-none flex items-center gap-2">
                                <ArrowRight className="w-3 h-3 group-open:rotate-90 transition-transform" /> Pogledaj metrike korišćene za analizu
                              </summary>
                              <div className="mt-2 pt-2 border-t text-muted-foreground grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                  <div>Prihod: <strong className="text-foreground">{item.a.snapshot.totalRevenue?.toLocaleString()} RSD</strong></div>
                                  <div>Zakazano termina: <strong className="text-foreground">{item.a.snapshot.totalBookings}</strong></div>
                                  <div>Završeno: <strong className="text-foreground">{item.a.snapshot.completedBookings}</strong></div>
                                  <div>Otkazano: <strong className="text-foreground">{item.a.snapshot.cancelledBookings}</strong></div>
                                  <div>No-show: <strong className="text-foreground">{item.a.snapshot.noShowBookings}</strong></div>
                                </div>
                                <div className="space-y-1">
                                  <div>Ukupno klijenata: <strong className="text-foreground">{item.a.snapshot.totalCustomers}</strong></div>
                                  {item.a.snapshot.retentionCounts && (
                                    <div className="text-[10px]">
                                      Novi: {item.a.snapshot.retentionCounts.NEW} | 
                                      Aktivni: {item.a.snapshot.retentionCounts.ACTIVE} | 
                                      VIP: {item.a.snapshot.retentionCounts.VIP} | 
                                      Rizik: {item.a.snapshot.retentionCounts.AT_RISK} | 
                                      Izgubljeni: {item.a.snapshot.retentionCounts.LOST}
                                    </div>
                                  )}
                                  <div className="mt-2 pt-2 border-t text-[10px] text-muted-foreground">
                                    Generisano: {new Date(item.a.snapshot.generatedAt).toLocaleString('sr-RS')}
                                  </div>
                                </div>
                              </div>
                            </details>
                          )}

                          {/* Quick Actions if AI detected campaign opportunity */}
                          {(item.a.answer.toLowerCase().includes("kampanja") || item.a.answer.toLowerCase().includes("automatizacija") || item.a.answer.toLowerCase().includes("email")) && (
                            <div className="pt-3 border-t mt-3 flex justify-end">
                              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => handleOpenDraft(item.a.answer)}>
                                <Plus className="w-4 h-4 mr-2" /> Kreiraj ovu kampanju kao nacrt
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-4 bg-background border-t shrink-0">
            <div className="relative max-w-4xl mx-auto">
              <Input 
                placeholder="Pitajte bilo šta o poslovanju vašeg salona..." 
                className="pr-12 py-6 text-sm rounded-2xl shadow-sm border-muted-foreground/20 focus-visible:ring-indigo-500"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAsk(question)}
                disabled={askMutation.isPending}
              />
              <Button 
                size="icon" 
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-indigo-600 hover:bg-indigo-700 h-9 w-9"
                disabled={!question.trim() || askMutation.isPending}
                onClick={() => handleAsk(question)}
              >
                {askMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 text-white" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={!!proposalDraft} onOpenChange={(open) => !open && setProposalDraft(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Nacrt AI Kampanje</DialogTitle>
            <DialogDescription>
              Ova kampanja će biti sačuvana u stanju <strong>Pauzirano</strong>. Nikada nećemo poslati poruke bez vaše izričite potvrde.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <p className="text-sm font-semibold">Naziv kampanje</p>
              <Input value={proposalDraft?.name || ""} onChange={e => setProposalDraft({...proposalDraft, name: e.target.value})} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Okidač</p>
              <Input disabled value={`${proposalDraft?.trigger || ""} (${proposalDraft?.triggerConfig?.inactiveDays || 0} dana)`} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Sadržaj Email-a</p>
              <Input value={proposalDraft?.emailSubject || ""} onChange={e => setProposalDraft({...proposalDraft, emailSubject: e.target.value})} />
              <textarea 
                className="w-full flex min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={proposalDraft?.emailBody || ""}
                onChange={e => setProposalDraft({...proposalDraft, emailBody: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Promo kod</p>
              <Input value={proposalDraft?.voucherCode || ""} onChange={e => setProposalDraft({...proposalDraft, voucherCode: e.target.value})} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProposalDraft(null)}>Odustani</Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleCreateDraft} disabled={createDraftMutation.isPending}>
              {createDraftMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj kao nacrt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BusinessLayout>
  );
}
