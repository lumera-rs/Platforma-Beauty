import legalPages from "@/content/legal-pages.json";
import { Layout } from "@/components/layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FileWarning } from "lucide-react";

type LegalSection = {
  title: string;
  paragraphs: string[];
};

type LegalDocument = {
  path: string;
  title: string;
  lead: string;
  lastUpdated: string;
  sections: LegalSection[];
};

export default function LegalPage({ pagePath }: { pagePath: string }) {
  const document = (legalPages as LegalDocument[]).find((page) => page.path === pagePath);

  if (!document) return null;

  return (
    <Layout>
      <main className="bg-muted/20 py-10 sm:py-16">
        <article className="container mx-auto max-w-4xl px-4">
          <header className="rounded-2xl border bg-card p-6 shadow-sm sm:p-10">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">LUMERA pravni dokumenti</p>
            <h1 className="mt-3 font-serif text-4xl font-bold tracking-tight sm:text-5xl">{document.title}</h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">{document.lead}</p>
            <p className="mt-5 text-sm text-muted-foreground">Poslednje ažuriranje: {document.lastUpdated}</p>
          </header>

          <Alert className="mt-6 border-amber-300 bg-amber-50 text-amber-950" data-testid="legal-draft-notice">
            <FileWarning className="h-4 w-4" />
            <AlertTitle>Radna pravna verzija</AlertTitle>
            <AlertDescription>
              Tekst operativno opisuje način rada Platforme, ali mora biti potvrđen od strane odgovornog pravnog lica i pravnog savetnika pre komercijalnog lansiranja.
            </AlertDescription>
          </Alert>

          <div className="mt-6 space-y-4">
            {document.sections.map((section) => (
              <section key={section.title} className="rounded-2xl border bg-card p-6 sm:p-8">
                <h2 className="font-serif text-2xl font-semibold">{section.title}</h2>
                <div className="mt-4 space-y-4 text-[1.02rem] leading-7 text-muted-foreground">
                  {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
              </section>
            ))}
          </div>
        </article>
      </main>
    </Layout>
  );
}