import { Link } from "wouter";

export function BusinessFooter() {
  return (
    <footer className="bg-foreground text-background py-16 mt-auto border-t border-white/5">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="md:col-span-1">
            <Link href="/za-biznise" className="inline-block mb-4 flex items-center gap-2 group">
              <span className="font-serif text-2xl font-bold tracking-tight text-white group-hover:text-white/90 transition-colors">LUMERA</span>
              <span className="text-accent text-sm font-sans tracking-normal uppercase relative -top-1">Biznis</span>
            </Link>
            <p className="text-sm text-background/60 leading-relaxed mb-6">
              Premijum operativni partner za moderne salone, wellness centre i edukatore. Podignite svoj biznis na viši nivo.
            </p>
          </div>
          
          <div>
            <h4 className="font-serif text-lg mb-4 text-accent">Platforma</h4>
            <ul className="space-y-3 text-sm text-background/80">
              <li><Link href="/za-biznise" className="hover:text-white transition-colors">Prednosti</Link></li>
              <li><a href="/za-biznise#platforma" className="hover:text-white transition-colors">Poslovna platforma</a></li>
              <li><Link href="/" className="hover:text-white transition-colors">Klijentski Market</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-serif text-lg mb-4 text-accent">Partnerstvo</h4>
            <ul className="space-y-3 text-sm text-background/80">
              <li><Link href="/poslovna-registracija" className="hover:text-white transition-colors">Postanite Partner</Link></li>
              <li><Link href="/poslovna-prijava" className="hover:text-white transition-colors">Prijava za Partnere</Link></li>
              <li><a href="mailto:partneri@lumera.rs" className="hover:text-white transition-colors">Kontaktirajte Nas</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-serif text-lg mb-4 text-accent">Pravno</h4>
            <ul className="space-y-3 text-sm text-background/80">
              <li><Link href="/uslovi-koriscenja" className="hover:text-white transition-colors">Uslovi Korišćenja</Link></li>
              <li><Link href="/politika-privatnosti" className="hover:text-white transition-colors">Politika Privatnosti</Link></li>
              <li><Link href="/uslovi-kupovine" className="hover:text-white transition-colors">Uslovi Kupovine</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between text-sm text-background/50">
          <p>© {new Date().getFullYear()} Lumera Business. Sva prava zadržana.</p>
          <div className="flex gap-4 mt-4 md:mt-0">
            <span>Beograd, Srbija</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
