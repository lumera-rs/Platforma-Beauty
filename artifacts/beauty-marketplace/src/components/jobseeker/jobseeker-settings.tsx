import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useGetCurrentUser,
  useUpdateEmailPreferences,
  useLogout,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormDescription } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LogOut, Mail } from "lucide-react";
import { toast } from "sonner";

const settingsSchema = z.object({
  marketingEmailsEnabled: z.boolean(),
});

export default function JobseekerSettings() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: userResp, isLoading } = useGetCurrentUser();
  const updatePrefs = useUpdateEmailPreferences();
  const logout = useLogout();
  const user = userResp?.user;

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      marketingEmailsEnabled: false,
    },
  });

  useEffect(() => {
    if (user) {
      form.reset({
        marketingEmailsEnabled: user.marketingEmailsEnabled,
      });
    }
  }, [user, form]);

  const onSubmit = (values: z.infer<typeof settingsSchema>) => {
    updatePrefs.mutate({ data: values }, {
      onSuccess: () => {
        toast.success("Podešavanja su sačuvana");
        queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      },
      onError: () => {
        toast.error("Došlo je do greške prilikom čuvanja.");
      }
    });
  };

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        setLocation("/");
      },
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Podešavanja naloga</h1>
        <p className="text-muted-foreground mt-1">Upravljajte svojim osnovnim podešavanjima i privatnošću.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="w-5 h-5 text-primary" /> Obaveštenja i privatnost</CardTitle>
          <CardDescription>Podešavanje marketing mejlova i obaveštenja.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="marketingEmailsEnabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Marketing poruke i ponude</FormLabel>
                      <FormDescription>
                        Primajte povremene mejlove o novim poslovima, edukacijama i dešavanjima.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={updatePrefs.isPending}>
                {updatePrefs.isPending ? "Čuvanje..." : "Sačuvaj podešavanja"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card className="border-destructive/20 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-destructive">Odjava</CardTitle>
          <CardDescription>Bezbedno se odjavite sa svog profila.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={handleLogout} className="gap-2">
            <LogOut className="w-4 h-4" /> Odjavi se
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}