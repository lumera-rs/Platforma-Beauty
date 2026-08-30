import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { CheckCircle2, Loader2, LockKeyhole } from "lucide-react";
import { useCompleteCustomerPasswordSetup, useValidateCustomerPasswordSetup } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function CustomerPasswordSetupPage() {
  const [, setLocation] = useLocation();
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [formError, setFormError] = useState("");
  const validation = useValidateCustomerPasswordSetup();
  const completion = useCompleteCustomerPasswordSetup();
  const validationStarted = useRef(false);

  useEffect(() => {
    document.title = "Postavljanje lozinke | LUMERA";
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    if (validationStarted.current) return;
    validationStarted.current = true;
    if (!token) return;
    validation.mutate({ data: { token } });
  }, [token]);

  useEffect(() => {
    if (!completion.isSuccess) return;
    const timeout = window.setTimeout(() => setLocation("/prijava"), 1200);
    return () => window.clearTimeout(timeout);
  }, [completion.isSuccess, setLocation]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (password !== passwordConfirmation) {
      setFormError("Lozinke se ne podudaraju.");
      return;
    }
    completion.mutate(
      { data: { token, password, passwordConfirmation } },
      { onError: () => setFormError("Link nije važeći ili više nije dostupan. Zatražite novi link od administratora.") },
    );
  };

  const invalid = !token || validation.isError;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background to-muted/40 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl sm:p-8" aria-labelledby="setup-title">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LockKeyhole className="h-6 w-6" />
        </div>
        <h1 id="setup-title" className="font-serif text-2xl font-bold text-foreground">Postavite lozinku</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Izaberite lozinku za svoj LUMERA korisnički nalog.
        </p>

        {validation.isPending ? (
          <div className="flex items-center gap-3 py-10 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Proveravamo jednokratni link…
          </div>
        ) : invalid ? (
          <div className="mt-6 space-y-5">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
              Link nije važeći ili više nije dostupan. Zatražite novi link od administratora.
            </div>
            <Button asChild variant="outline" className="w-full"><Link href="/prijava">Idi na prijavu</Link></Button>
          </div>
        ) : completion.isSuccess ? (
          <div className="mt-6 space-y-5 text-center" role="status">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <div>
              <p className="font-semibold">Lozinka je uspešno postavljena.</p>
              <p className="mt-1 text-sm text-muted-foreground">Preusmeravamo vas na prijavu…</p>
            </div>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={submit}>
            <div>
              <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium">Nova lozinka</label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={200}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">Najmanje 8 karaktera.</p>
            </div>
            <div>
              <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium">Potvrdite lozinku</label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={200}
                required
                value={passwordConfirmation}
                onChange={(event) => setPasswordConfirmation(event.target.value)}
              />
            </div>
            {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
            <Button type="submit" className="w-full" disabled={completion.isPending}>
              {completion.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sačuvaj lozinku
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}