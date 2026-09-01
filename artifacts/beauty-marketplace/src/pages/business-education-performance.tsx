import React from "react";
import { useGetEducationInstructorPerformance, useGetEducationCenterStatus, useGetCurrentUser } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, TrendingUp, CheckCircle, GraduationCap, Users, BookOpen } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export default function BusinessEducationPerformance() {
  const { data: userResp } = useGetCurrentUser();
  const { data: statusList, isLoading: isStatusLoading } = useGetEducationCenterStatus({ 
    query: { enabled: Boolean(userResp?.user), queryKey: ["educationCenterStatus"] } 
  });
  const centerId = statusList?.[0]?.id || "";
  
  const { data: perfResp, isLoading } = useGetEducationInstructorPerformance(centerId, { 
    query: { enabled: Boolean(centerId), queryKey: ["query", centerId] } 
  });
  
  const instructors = perfResp?.instructors || [];

  if (isStatusLoading || isLoading) {
    return <BusinessLayout><div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div></BusinessLayout>;
  }

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-bold text-foreground">Učinak predavača</h1>
          <p className="text-muted-foreground mt-1">Broj kurseva, upisa i stopa završetka po predavaču</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {instructors.map((inst, idx) => {
            const completionRate = inst.enrollments > 0 ? Math.round((inst.completions / inst.enrollments) * 100) : 0;
            return (
              <Card key={inst.instructorId || idx}>
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                      <GraduationCap className="w-5 h-5" />
                    </div>
                    Predavač ID: {inst.instructorId || "Nepoznato"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium flex items-center"><CheckCircle className="w-4 h-4 mr-1.5 text-emerald-500" /> Stopa završetka kurseva</span>
                      <span className="font-bold">{completionRate}%</span>
                    </div>
                    <Progress value={completionRate} className="h-2" />
                  </div>

                  <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                    <div className="text-center">
                      <div className="w-8 h-8 mx-auto bg-muted rounded-full flex items-center justify-center mb-2">
                        <BookOpen className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="font-bold text-xl">{inst.courses}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Kurseva</div>
                    </div>
                    <div className="text-center">
                      <div className="w-8 h-8 mx-auto bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mb-2">
                        <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="font-bold text-xl text-blue-700 dark:text-blue-400">{inst.enrollments}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Upisa</div>
                    </div>
                    <div className="text-center">
                      <div className="w-8 h-8 mx-auto bg-emerald-50 dark:bg-emerald-900/20 rounded-full flex items-center justify-center mb-2">
                        <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="font-bold text-xl text-emerald-700 dark:text-emerald-400">{inst.completions}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Završeno</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {instructors.length === 0 && (
            <div className="col-span-full py-16 text-center text-muted-foreground border-2 border-dashed rounded-xl">
              <TrendingUp className="w-16 h-16 mx-auto mb-4 opacity-40" />
              <h3 className="text-lg font-medium mb-1 text-foreground">Nema podataka o predavačima</h3>
              <p>Statistika učinka će biti dostupna kada predavači budu imali aktivne ili završene kurseve.</p>
            </div>
          )}
        </div>
      </div>
    </BusinessLayout>
  );
}
