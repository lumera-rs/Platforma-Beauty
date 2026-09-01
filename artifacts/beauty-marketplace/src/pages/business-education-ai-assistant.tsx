import React, { useState } from "react";
import { useEducationCenterAssistant, useGetEducationCenterStatus, useGetCurrentUser } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Bot, Send, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function BusinessEducationAiAssistant() {
  const { data: userResp } = useGetCurrentUser();
  const { data: statusList, isLoading: isStatusLoading } = useGetEducationCenterStatus({ 
    query: { enabled: Boolean(userResp?.user), queryKey: ["educationCenterStatus"] } 
  });
  const centerId = statusList?.[0]?.id || "";
  
  const assistantMut = useEducationCenterAssistant();
  const { toast } = useToast();

  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant', text: string }>>([
    { role: 'assistant', text: 'Pozdrav! Ja sam AI asistent edukativnog centra. Kako vam mogu pomoći oko rasporeda, analize kurseva ili administracije?' }
  ]);

  const handleSend = () => {
    if (!prompt.trim()) return;
    
    const userMessage = prompt;
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setPrompt("");

    assistantMut.mutate({
      centerId,
      data: { prompt: userMessage }
    }, {
      onSuccess: (res) => {
        setMessages(prev => [...prev, { role: 'assistant', text: res?.reply || "Razumem. Komanda je uspešno obrađena." }]);
      },
      onError: () => {
        toast.error("Greška u komunikaciji");
        setMessages(prev => [...prev, { role: 'assistant', text: "Došlo je do greške u povezivanju sa asistentom. Molim pokušajte ponovo." }]);
      }
    });
  };

  if (isStatusLoading) {
    return <BusinessLayout><div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div></BusinessLayout>;
  }

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 max-w-4xl h-[calc(100vh-8rem)] flex flex-col">
        <div className="mb-6 flex items-center gap-3 shrink-0">
          <div className="w-12 h-12 bg-accent/10 rounded-xl flex items-center justify-center text-accent">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">AI asistent</h1>
            <p className="text-muted-foreground text-sm">Pametno upravljanje centrom zasnovano na vašim podacima</p>
          </div>
        </div>

        <Card className="flex-1 flex flex-col min-h-0 overflow-hidden border-muted">
          <CardContent className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex gap-4 max-w-[85%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center ${msg.role === 'assistant' ? 'bg-accent text-accent-foreground' : 'bg-primary text-primary-foreground'}`}>
                  {msg.role === 'assistant' ? <Sparkles className="w-4 h-4" /> : <span className="font-bold text-xs">VI</span>}
                </div>
                <div className={`p-4 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'assistant' 
                    ? 'bg-muted/50 text-foreground rounded-tl-sm' 
                    : 'bg-primary text-primary-foreground rounded-tr-sm'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {assistantMut.isPending && (
              <div className="flex gap-4 max-w-[85%]">
                <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center bg-accent text-accent-foreground">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="p-4 rounded-2xl bg-muted/50 rounded-tl-sm flex items-center">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </CardContent>
          <div className="p-4 border-t bg-card shrink-0">
            <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-3">
              <Input 
                value={prompt} 
                onChange={(e) => setPrompt(e.target.value)} 
                placeholder="Pitaj me o slobodnim salama, predavačima..." 
                className="flex-1 bg-muted/20"
                disabled={assistantMut.isPending}
              />
              <Button type="submit" disabled={!prompt.trim() || assistantMut.isPending} className="px-6">
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </Card>
      </div>
    </BusinessLayout>
  );
}