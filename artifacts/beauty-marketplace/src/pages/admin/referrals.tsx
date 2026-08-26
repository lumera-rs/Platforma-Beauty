import { useState } from "react";
import { AdminLayout } from "./layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAdminListReferralApprovals, useAdminDecideReferralApproval, useAdminListReferralReviews, useAdminReviewReferral, getAdminListReferralApprovalsQueryKey, getAdminListReferralReviewsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, XCircle, RefreshCcw, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";

export default function AdminReferrals() {
  const [activeTab, setActiveTab] = useState("approvals");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: approvals, isLoading: isLoadingApprovals } = useAdminListReferralApprovals();
  const { data: reviews, isLoading: isLoadingReviews } = useAdminListReferralReviews();

  const decideApproval = useAdminDecideReferralApproval();
  const reviewReferral = useAdminReviewReferral();

  const handleApproval = (id: string, action: "approve" | "reject" | "resubmit", reason?: string) => {
    decideApproval.mutate(
      { attributionId: id, data: { action, reason } },
      {
        onSuccess: () => {
          toast.success(`Akcija ${action} uspešno izvršena`);
          queryClient.invalidateQueries({ queryKey: getAdminListReferralApprovalsQueryKey() });
        },
        onError: () => {
          toast.error("Došlo je do greške prilikom obrade zahteva");
        }
      }
    );
  };

  const handleReview = (id: string, status: "approved" | "rejected" | "dismissed", detail?: string) => {
    reviewReferral.mutate(
      { reviewId: id, data: { status, detail } },
      {
        onSuccess: () => {
          toast.success(`Revizija završena statusom ${status}`);
          queryClient.invalidateQueries({ queryKey: getAdminListReferralReviewsQueryKey() });
        },
        onError: () => {
          toast.error("Došlo je do greške prilikom revizije");
        }
      }
    );
  };

  return (
    <AdminLayout>
      <div className="flex-1 w-full space-y-6">
        <div>
            <h1 className="text-3xl font-serif font-bold">Upravljanje preporukama</h1>
            <p className="text-muted-foreground mt-1">Pregled zahteva i sumnjivih obrazaca preporuka.</p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="approvals">
                Odobrenja ({approvals?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="reviews">
                Revizije ({reviews?.length || 0})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="approvals" className="space-y-4">
              {isLoadingApprovals ? (
                <div className="flex justify-center p-8"><Loader2 className="animate-spin w-8 h-8 text-primary" /></div>
              ) : approvals?.length === 0 ? (
                <Card className="text-center py-12 text-muted-foreground border-dashed">
                  Nema preporuka koje čekaju odobrenje.
                </Card>
              ) : (
                <div className="grid gap-4">
                  {approvals?.map(approval => (
                    <Card key={approval.attributionId}>
                      <CardHeader className="pb-3 border-b">
                        <div className="flex justify-between items-start">
                          <div>
                            <CardTitle className="text-lg flex items-center gap-2">
                              Kanal {approval.channel}
                              <Badge variant="outline">{approval.businessKind}</Badge>
                            </CardTitle>
                            <CardDescription>Kreirano: {format(parseISO(approval.createdAt), "dd.MM.yyyy HH:mm")}</CardDescription>
                          </div>
                          <Badge className="bg-amber-100 text-amber-800 border-none">{approval.status}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 flex flex-wrap gap-2 justify-end">
                        <Button 
                          variant="outline" 
                          className="border-red-200 text-red-700 hover:bg-red-50"
                          onClick={() => handleApproval(approval.attributionId, "reject", "Odbijeno od strane administratora")}
                          disabled={decideApproval.isPending}
                        >
                          <XCircle className="w-4 h-4 mr-2" /> Odbij
                        </Button>
                        <Button 
                          variant="outline" 
                          onClick={() => handleApproval(approval.attributionId, "resubmit", "Potrebna dodatna dokumentacija")}
                          disabled={decideApproval.isPending}
                        >
                          <RefreshCcw className="w-4 h-4 mr-2" /> Vrati na doradu
                        </Button>
                        <Button 
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => handleApproval(approval.attributionId, "approve")}
                          disabled={decideApproval.isPending}
                        >
                          <CheckCircle className="w-4 h-4 mr-2" /> Odobri
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="reviews" className="space-y-4">
              {isLoadingReviews ? (
                <div className="flex justify-center p-8"><Loader2 className="animate-spin w-8 h-8 text-primary" /></div>
              ) : reviews?.length === 0 ? (
                <Card className="text-center py-12 text-muted-foreground border-dashed">
                  Nema sumnjivih preporuka za reviziju.
                </Card>
              ) : (
                <div className="grid gap-4">
                  {reviews?.map(review => (
                    <Card key={review.id} className="border-amber-200">
                      <CardHeader className="pb-3 border-b bg-amber-50/50">
                        <div className="flex justify-between items-start">
                          <div>
                            <CardTitle className="text-lg flex items-center gap-2 text-amber-900">
                              <AlertTriangle className="w-5 h-5 text-amber-500" />
                              Revizija #{review.id.slice(0, 8)}
                            </CardTitle>
                            <CardDescription>Razlog: <strong>{review.reasonCode}</strong></CardDescription>
                          </div>
                          <Badge variant="outline">{review.status}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 space-y-4">
                        <div className="text-sm">
                          <span className="text-muted-foreground">Detalji: </span>
                          <span className="font-medium">{review.detail || "Nema dodatnih detalja"}</span>
                        </div>
                        {review.score !== null && (
                          <div className="text-sm">
                            <span className="text-muted-foreground">Rizik (Score): </span>
                            <span className="font-medium text-amber-700">{review.score}</span>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2 justify-end pt-2">
                          <Button 
                            variant="outline"
                            onClick={() => handleReview(review.id, "dismissed")}
                            disabled={reviewReferral.isPending}
                          >
                            Odbaci prijavu
                          </Button>
                          <Button 
                            variant="outline" 
                            className="border-red-200 text-red-700 hover:bg-red-50"
                            onClick={() => handleReview(review.id, "rejected")}
                            disabled={reviewReferral.isPending}
                          >
                            <XCircle className="w-4 h-4 mr-2" /> Poništi preporuku
                          </Button>
                          <Button 
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => handleReview(review.id, "approved")}
                            disabled={reviewReferral.isPending}
                          >
                            <CheckCircle className="w-4 h-4 mr-2" /> Odobri (Validno)
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
      </div>
    </AdminLayout>
  );
}
