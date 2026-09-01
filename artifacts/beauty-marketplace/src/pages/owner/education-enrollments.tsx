import { Link } from "wouter";
import { useListEnrollments, getListEnrollmentsQueryKey } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap } from "lucide-react";

const statusLabel: Record<string, string> = {
  pending: "Čeka potvrdu uplate",
  active: "Aktivna",
  completed: "Završena",
  cancelled: "Otkazana",
};

export default function OwnerEducationEnrollments() {
  const { data: enrollments, isLoading } = useListEnrollments(undefined, {
    query: { queryKey: getListEnrollmentsQueryKey() },
  });
  const ownedPurchases = (enrollments ?? []).filter((enrollment) => enrollment.employeeId);

  return (
    <BusinessLayout>
      <main className="container mx-auto max-w-5xl px-4 py-8">
        <div className="mb-7">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Edukacije tima</p>
          <h1 className="font-serif text-3xl font-bold">Moje prijave zaposlenih</h1>
          <p className="mt-1 text-muted-foreground">Status uplate i pristupa za mesta koja je kupio vaš salon.</p>
        </div>
        {isLoading ? <Skeleton className="h-36 w-full" /> : ownedPurchases.length ? (
          <div className="space-y-3">
            {ownedPurchases.map((enrollment) => (
              <Link key={enrollment.id} href={`/biznis/edukacije/${enrollment.courseId}`} data-testid={`link-owner-enrollment-${enrollment.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                    <div>
                      <p className="font-semibold" data-testid={`text-owner-enrollment-course-${enrollment.id}`}>{enrollment.courseTitle}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{enrollment.learnerName}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant={enrollment.paymentStatus === "paid" ? "default" : "secondary"} data-testid={`status-owner-enrollment-${enrollment.id}`}>
                        {statusLabel[enrollment.status] ?? enrollment.status}
                      </Badge>
                      <p className="mt-1 text-xs text-muted-foreground">{enrollment.paymentStatus === "paid" ? "Uplata potvrđena" : "Uplata nije potvrđena"}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card>
            <CardHeader className="items-center py-14 text-center">
              <GraduationCap className="mb-3 h-10 w-10 text-muted-foreground" />
              <CardTitle>Nema prijava zaposlenih</CardTitle>
              <p className="text-sm text-muted-foreground">Kada kupite kurs za zaposlenog, prijava će biti prikazana ovde.</p>
            </CardHeader>
          </Card>
        )}
      </main>
    </BusinessLayout>
  );
}