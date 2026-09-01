import React, { useEffect, useState } from "react";
import { useGetEducationCenterCrm, useGetEducationCenterStatus, useGetCurrentUser } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Users, BookOpen, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EducationFieldHelp } from "@/components/education/education-field-help";

export default function BusinessEducationCrm() {
  const { data: userResp } = useGetCurrentUser();
  const { data: statusList, isLoading: isStatusLoading } = useGetEducationCenterStatus({ 
    query: { enabled: Boolean(userResp?.user), queryKey: ["educationCenterStatus"] } 
  });
  const [selectedCenterId, setSelectedCenterId] = useState("");
  const centerId = selectedCenterId || statusList?.[0]?.id || "";
  useEffect(() => {
    if (statusList?.length && !statusList.some((center) => center.id === selectedCenterId)) {
      setSelectedCenterId(statusList[0]!.id);
    }
  }, [selectedCenterId, statusList]);
  
  const { data: crmResp, isLoading } = useGetEducationCenterCrm(centerId, { 
    query: { enabled: Boolean(centerId), queryKey: ["query", centerId] } 
  });
  
  const learners = crmResp?.learners || [];

  if (isStatusLoading || isLoading) {
    return <BusinessLayout><div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div></BusinessLayout>;
  }

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center mb-8">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">Polaznici</h1>
            <p className="text-muted-foreground mt-1">Evidencija polaznika i ukupna statistika pohađanja</p>
          </div>
          {(statusList?.length ?? 0) > 1 && (
            <div className="flex items-center gap-1">
              <EducationFieldHelp id="education-crm-center-picker-help" label="Edukativni centar za CRM" text="Izaberite centar čiju evidenciju polaznika i statistiku završenih edukacija želite da pregledate." />
              <Select value={centerId} onValueChange={setSelectedCenterId}>
                <SelectTrigger className="w-full sm:w-72" aria-label="Izaberite edukativni centar" aria-describedby="education-crm-center-picker-help">
                  <SelectValue placeholder="Izaberite edukativni centar" />
                </SelectTrigger>
                <SelectContent>
                  {statusList!.map((center) => (
                    <SelectItem key={center.id} value={center.id}>{center.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="grid gap-6">
          {learners.map((learner, idx) => (
            <Card key={learner.userId || idx}>
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center text-accent font-serif font-bold text-xl shrink-0">
                      <Users className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg" data-testid={`text-crm-participant-${learner.userId || idx}`}>{learner.learnerName}</h3>
                      <p className="text-xs text-muted-foreground">Polaznik {learner.userId ? `ID: ${learner.userId}` : "bez povezanog naloga"}</p>
                    </div>
                  </div>
                  <div className="flex gap-4 min-w-[200px]">
                    <div className="flex flex-col items-center p-3 bg-muted rounded-xl">
                      <span className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" /> Upisano</span>
                      <span className="font-bold text-xl">{learner.count}</span>
                    </div>
                    <div className="flex flex-col items-center p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-xl">
                      <span className="text-xs mb-1 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Završeno</span>
                      <span className="font-bold text-xl">{learner.completed}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {learners.length === 0 && (
            <div className="py-16 text-center text-muted-foreground border-2 border-dashed rounded-xl">
              <Users className="w-16 h-16 mx-auto mb-4 opacity-40" />
              <h3 className="text-lg font-medium mb-1 text-foreground">Nema podataka o polaznicima</h3>
              <p>Ovde će se pojaviti polaznici koji su upisali ili završili vaše kurseve.</p>
            </div>
          )}
        </div>
      </div>
    </BusinessLayout>
  );
}
