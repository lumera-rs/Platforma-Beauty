import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { OptimizedImage } from "@/components/optimized-image";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/use-debounce";

type GuideKind = "inspiration" | "glossary" | "brands";

export default function MarketplaceGuides({ kind }: { kind: GuideKind }) {
  const [items, setItems] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  // Debounce the value driving the client-side filter; the input stays immediate.
  const debouncedQuery = useDebounce(query, 300);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`/api/${kind === "inspiration" ? "inspiracija" : kind === "glossary" ? "recnik" : "brendovi"}`)
      .then((response) => response.json()).then(setItems).finally(() => setLoading(false));
  }, [kind]);
  const filtered = items.filter((item) => JSON.stringify(item).toLowerCase().includes(debouncedQuery.toLowerCase()));
  const copy = kind === "inspiration"
    ? ["Inspiracija za sledeći termin", "Pogledajte stilove, tretmane i ideje koje rade LUMERA saloni."]
    : kind === "glossary"
      ? ["Rečnik beauty pojmova", "Jasna objašnjenja tretmana i tehnika pre zakazivanja."]
      : ["Brendovi u salonima", "Pronađite salone prema profesionalnim proizvodima koje koriste."];
  return <Layout><main className="container mx-auto px-4 py-10 md:py-14">
    <div className="mb-8 max-w-2xl"><p className="text-primary text-sm font-semibold uppercase tracking-widest">LUMERA vodič</p><h1 className="mt-2 text-4xl font-serif font-bold">{copy[0]}</h1><p className="mt-3 text-muted-foreground">{copy[1]}</p></div>
    <div className="relative mb-8 max-w-md"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Pretražite..." /></div>
    {loading ? <div className="py-16 flex justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div> : kind === "inspiration" ? <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">{filtered.map((item) => <article key={item.id} className="overflow-hidden rounded-2xl border bg-card"><OptimizedImage className="aspect-[4/3] w-full object-cover" src={item.imageUrl} alt={item.title} width={640} height={480} sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" /><div className="p-4"><h2 className="font-serif text-xl font-bold">{item.title}</h2><div className="mt-2 flex gap-1 flex-wrap">{item.tags.map((tag: string) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div>{item.salon && <Link href={`/saloni/${item.salon.slug}`} className="mt-3 block text-sm text-primary font-medium">{item.salon.name} {item.serviceName ? `· ${item.serviceName}` : ""}</Link>}</div></article>)}</div> : <div className="grid md:grid-cols-2 gap-4">{filtered.map((item) => <article key={item.id} className="rounded-xl border bg-card p-5"><div className="flex justify-between gap-4"><h2 className="font-serif text-xl font-bold">{item.term ?? item.name}</h2>{item.category && <Badge variant="secondary">{item.category}</Badge>}</div><p className="mt-2 text-muted-foreground">{item.definition ?? item.description}</p>{item.salonCount !== undefined && <p className="mt-3 text-sm font-medium text-primary">{item.salonCount} salona koristi ovaj brend</p>}</article>)}</div>}
    {!loading && !filtered.length && <p className="py-12 text-center text-muted-foreground">Nema rezultata za izabranu pretragu.</p>}
  </main></Layout>;
}