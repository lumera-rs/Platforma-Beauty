import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, HelpCircle, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BusinessLayout } from "@/components/business-layout";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

type GuideSection = {
  id: string;
  title: string;
  route?: string;
  purpose: string;
  steps?: string[];
  notes?: string[];
};

type GuideChapter = {
  id: string;
  title: string;
  audience: "SVI" | "VLASNIK" | "ZAPOSLENI";
  intro?: string;
  sections: GuideSection[];
};

type BusinessGuide = {
  version: string;
  updatedAt: string;
  title: string;
  subtitle: string;
  audienceNote: string;
  chapters: GuideChapter[];
  quickReference: { module: string; route: string; roles: string }[];
};

const PDF_URL = "/api/business/guide.pdf";

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day}.${month}.${year}.`;
}

function audienceBadge(audience: GuideChapter["audience"]) {
  switch (audience) {
    case "VLASNIK":
      return { label: "Za vlasnike salona", className: "bg-accent/15 text-accent-foreground border-accent/30" };
    case "ZAPOSLENI":
      return { label: "Za zaposlene", className: "bg-primary/10 text-primary border-primary/20" };
    default:
      return { label: "Za sve poslovne korisnike", className: "bg-muted text-muted-foreground border-border" };
  }
}

export default function BusinessGuidePage() {
  const { data: userResp } = useGetCurrentUser();
  const role = userResp?.user?.role;

  const { data: guide, isLoading, isError, refetch } = useQuery<BusinessGuide>({
    queryKey: ["business-guide"],
    staleTime: Infinity,
    queryFn: async () => {
      const response = await fetch("/api/business/guide");
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "Vodič trenutno nije dostupan.");
      }
      return await response.json() as BusinessGuide;
    },
  });

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-10 max-w-4xl">
        <header className="mb-10">
          <div className="flex items-center gap-2 text-accent mb-3">
            <HelpCircle className="w-5 h-5" />
            <span className="text-sm font-medium uppercase tracking-wide">Pomoć</span>
          </div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold mb-2" data-testid="text-guide-title">
            {guide?.title ?? "LUMERA Biznis — Vodič za partnere"}
          </h1>
          <p className="text-muted-foreground mb-6">
            {guide?.subtitle ?? "Detaljan priručnik za vlasnike salona i zaposlene"}
            {guide && (
              <span className="block mt-1 text-sm">
                Verzija {guide.version} · Ažurirano {formatDate(guide.updatedAt)}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild data-testid="button-download-guide-pdf">
              <a href={`${PDF_URL}?download=1`}>
                <Download className="w-4 h-4 mr-2" />
                Preuzmi PDF
              </a>
            </Button>
            <Button variant="outline" asChild data-testid="link-open-guide-pdf">
              <a href={PDF_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />
                Otvori PDF u novom tabu
              </a>
            </Button>
          </div>
        </header>

        {isLoading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Učitavanje vodiča...
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center" data-testid="status-guide-error">
            <p className="mb-4 text-destructive">Vodič trenutno nije moguće učitati.</p>
            <Button variant="outline" onClick={() => { void refetch(); }}>Pokušaj ponovo</Button>
          </div>
        )}

        {guide && (
          <>
            <div className="rounded-lg border bg-muted/40 p-4 mb-10 flex items-start gap-3 text-sm text-muted-foreground">
              <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5 text-accent" />
              <p>{guide.audienceNote}</p>
            </div>

            <nav aria-label="Sadržaj vodiča" className="mb-12 rounded-lg border p-5">
              <h2 className="font-serif text-lg font-bold mb-3">Sadržaj</h2>
              <ol className="space-y-2 list-decimal list-inside">
                {guide.chapters.map((chapter) => (
                  <li key={chapter.id}>
                    <a href={`#${chapter.id}`} className="font-medium hover:text-accent transition-colors" data-testid={`link-toc-${chapter.id}`}>
                      {chapter.title}
                    </a>
                  </li>
                ))}
                <li>
                  <a href="#brzo-snalazenje" className="font-medium hover:text-accent transition-colors">
                    Brzo snalaženje — moduli i adrese
                  </a>
                </li>
              </ol>
            </nav>

            {guide.chapters.map((chapter, chapterIndex) => {
              const badge = audienceBadge(chapter.audience);
              const highlighted =
                (chapter.audience === "VLASNIK" && role === "SALON_OWNER") ||
                (chapter.audience === "ZAPOSLENI" && role === "SALON_EMPLOYEE");
              return (
                <section key={chapter.id} id={chapter.id} className="mb-14 scroll-mt-24" data-testid={`section-chapter-${chapter.id}`}>
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <h2 className="font-serif text-2xl font-bold">
                      {chapterIndex + 1}. {chapter.title}
                    </h2>
                    <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border", badge.className)}>
                      {badge.label}{highlighted ? " · vaša uloga" : ""}
                    </span>
                  </div>
                  {chapter.intro && <p className="text-muted-foreground mb-6">{chapter.intro}</p>}

                  <div className="space-y-8">
                    {chapter.sections.map((section, sectionIndex) => (
                      <article key={section.id} id={section.id} className="scroll-mt-24">
                        <h3 className="text-lg font-bold mb-1">
                          {chapterIndex + 1}.{sectionIndex + 1} {section.title}
                        </h3>
                        {section.route && (
                          <p className="text-xs text-accent font-mono mb-2">Putanja: {section.route}</p>
                        )}
                        <p className="mb-3">{section.purpose}</p>
                        {section.steps && section.steps.length > 0 && (
                          <div className="mb-3">
                            <p className="text-sm font-semibold text-muted-foreground mb-1.5">Koraci</p>
                            <ol className="list-decimal list-outside ml-5 space-y-1.5">
                              {section.steps.map((step, i) => <li key={i}>{step}</li>)}
                            </ol>
                          </div>
                        )}
                        {section.notes && section.notes.length > 0 && (
                          <div className="rounded-md border-l-2 border-accent/60 bg-muted/30 px-4 py-3">
                            <p className="text-sm font-semibold text-muted-foreground mb-1.5">Napomene</p>
                            <ul className="list-disc list-outside ml-5 space-y-1.5 text-sm">
                              {section.notes.map((note, i) => <li key={i}>{note}</li>)}
                            </ul>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}

            <section id="brzo-snalazenje" className="mb-14 scroll-mt-24" data-testid="section-quick-reference">
              <h2 className="font-serif text-2xl font-bold mb-4">
                {guide.chapters.length + 1}. Brzo snalaženje — moduli i adrese
              </h2>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-left">
                      <th className="px-4 py-2.5 font-semibold">Modul</th>
                      <th className="px-4 py-2.5 font-semibold">Adresa</th>
                      <th className="px-4 py-2.5 font-semibold">Dostupno za</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guide.quickReference.map((row) => (
                      <tr key={row.route + row.module} className="border-t">
                        <td className="px-4 py-2">{row.module}</td>
                        <td className="px-4 py-2 font-mono text-xs">{row.route}</td>
                        <td className="px-4 py-2 text-muted-foreground">{row.roles}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </BusinessLayout>
  );
}
