import { Link } from "wouter";

export function Footer() {
  return (
    <footer className="bg-foreground text-background py-12 md:py-16 mt-auto">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-12">
          <div className="md:col-span-1">
            <Link href="/" className="inline-block mb-4">
              <span className="font-serif text-2xl font-bold tracking-tight">LUMERA</span>
            </Link>
            <p className="text-sm text-background/70 leading-relaxed mb-6">
              Otkrijte proverene salone, rezervišite tretmane i pronađite beauty edukacije širom Srbije.
            </p>
          </div>
          
          <div>
            <h4 className="font-serif text-lg mb-4 text-accent">Klijenti</h4>
            <ul className="space-y-3 text-sm text-background/80">
              <li><Link href="/saloni" className="hover:text-white transition-colors">Pronađi salon</Link></li>
              <li><Link href="/edukacije" className="hover:text-white transition-colors">Edukacije</Link></li>
              <li><Link href="/prijava" className="hover:text-white transition-colors">Prijavi se</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-serif text-lg mb-4 text-accent">Moj nalog</h4>
            <ul className="space-y-3 text-sm text-background/80">
              <li><Link href="/moj-nalog?tab=appointments" className="hover:text-white transition-colors">Moji termini</Link></li>
              <li><Link href="/moj-nalog?tab=favorites" className="hover:text-white transition-colors">Omiljeni saloni</Link></li>
              <li><Link href="/moj-nalog?tab=settings" className="hover:text-white transition-colors">Profil</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-serif text-lg mb-4 text-accent">Pravno</h4>
            <ul className="space-y-3 text-sm text-background/80">
              <li><Link href="/uslovi-koriscenja" className="hover:text-white transition-colors">Uslovi korišćenja</Link></li>
              <li><Link href="/politika-privatnosti" className="hover:text-white transition-colors">Politika privatnosti</Link></li>
              <li><Link href="/politika-kolacica" className="hover:text-white transition-colors">Politika kolačića</Link></li>
              <li><Link href="/uslovi-kupovine" className="hover:text-white transition-colors">Uslovi kupovine</Link></li>
              <li><Link href="/otkazivanje-termina" className="hover:text-white transition-colors">Otkazivanje termina</Link></li>
              <li><Link href="/povracaj-sredstava" className="hover:text-white transition-colors">Povraćaj sredstava</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t border-background/20 flex flex-col md:flex-row items-center justify-between text-sm text-background/60">
          <p>© {new Date().getFullYear()} Lumera. Sva prava zadržana.</p>
          <div className="flex gap-4 mt-4 md:mt-0">
            <span>Beograd, Srbija</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
