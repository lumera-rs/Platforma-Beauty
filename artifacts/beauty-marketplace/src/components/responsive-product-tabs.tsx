import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { ProductDocument } from "@workspace/api-client-react";
import { FileText, Download } from "lucide-react";
import { PublicProductDetail } from "@workspace/api-client-react";

interface ResponsiveProductTabsProps {
  product: any;
  documents: ProductDocument[];
}

export function ResponsiveProductTabs({ product, documents }: ResponsiveProductTabsProps) {
  const sections = [];
  
  if (product.description) {
    sections.push({ id: "description", title: "Opis", content: <p className="whitespace-pre-line text-muted-foreground">{product.description}</p> });
  }
  
  if (product.characteristics && product.characteristics.length > 0) {
    sections.push({ 
      id: "characteristics", 
      title: "Karakteristike", 
      content: (
        <dl className="divide-y text-sm">
          {product.characteristics.map((char: any, i: number) => (
            <div key={i} className="grid grid-cols-3 py-3">
              <dt className="font-medium text-foreground">{char.name}</dt>
              <dd className="col-span-2 text-muted-foreground">{char.value}</dd>
            </div>
          ))}
        </dl>
      ) 
    });
  }

  if (product.usageInstructions) {
    sections.push({ id: "usage", title: "Način upotrebe", content: <p className="whitespace-pre-line text-muted-foreground">{product.usageInstructions}</p> });
  }

  if (product.ingredients) {
    sections.push({ id: "ingredients", title: "Sastav", content: <p className="whitespace-pre-line text-muted-foreground">{product.ingredients}</p> });
  }

  if (documents && documents.length > 0) {
    sections.push({
      id: "documents",
      title: "Dokumentacija",
      content: (
        <ul className="space-y-3">
          {documents.map((doc) => (
            <li key={doc.id}>
              <a href={doc.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors group">
                <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">{doc.displayName}</p>
                  <p className="text-xs text-muted-foreground uppercase">{doc.contentType === 'application/pdf' ? 'PDF' : 'DOCX'}</p>
                </div>
                <Download className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
              </a>
            </li>
          ))}
        </ul>
      )
    });
  }

  if (sections.length === 0) return null;

  return (
    <div className="mt-12">
      {/* Desktop Tabs */}
      <div className="hidden md:block">
        <Tabs defaultValue={sections[0].id} className="w-full">
          <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent gap-6">
            {sections.map(s => (
              <TabsTrigger 
                key={s.id} 
                value={s.id}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-0 py-3 font-semibold"
              >
                {s.title}
              </TabsTrigger>
            ))}
          </TabsList>
          {sections.map(s => (
            <TabsContent key={s.id} value={s.id} className="pt-6 animate-in fade-in">
              {s.content}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Mobile Accordion */}
      <div className="md:hidden">
        <Accordion type="single" collapsible defaultValue={sections[0].id} className="w-full">
          {sections.map(s => (
            <AccordionItem key={s.id} value={s.id}>
              <AccordionTrigger className="text-base font-semibold">{s.title}</AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                {s.content}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
}
