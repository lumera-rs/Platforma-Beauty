import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays, Loader2 } from "lucide-react";
import { useListSalonAppointments, useGetCurrentUser, getListSalonAppointmentsQueryKey } from "@workspace/api-client-react";

export default function OwnerCalendar() {
  const { data: userResp } = useGetCurrentUser();
  const { data: appointments, isLoading } = useListSalonAppointments(undefined, { query: { enabled: !!userResp?.user, queryKey: getListSalonAppointmentsQueryKey(undefined) }});

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/kalendar" />
        
        <div className="flex-1 space-y-6 w-full">
          <div>
            <h1 className="text-3xl font-serif font-bold">Kalendar</h1>
            <p className="text-muted-foreground">Pregled svih zakazanih termina</p>
          </div>
          
          <Card className="min-h-[500px]">
             {isLoading ? (
                <div className="h-full w-full flex items-center justify-center p-20">
                   <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
             ) : (
                <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-4 mt-20">
                   <CalendarDays className="w-16 h-16 opacity-20" />
                   <p className="text-lg">Kalendar je trenutno prazan za odabrani period.</p>
                </div>
             )}
          </Card>
        </div>
      </div>
    </BusinessLayout>
  )
}