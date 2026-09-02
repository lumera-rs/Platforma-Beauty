/**
 * Izvor sadržaja za "LUMERA Biznis — Vodič za partnere" (PDF + in-app prikaz).
 *
 * Ovaj modul je jedini izvor istine za vodič: iz njega se generiše PDF
 * (business-guide-pdf.ts) i JSON za prikaz u aplikaciji (routes/business-guide.ts).
 *
 * Održavanje: kada se promeni meni, modul, dugme ili dozvola u owner/employee
 * dashboardu, ažurirajte odgovarajuću sekciju ovde i podignite GUIDE_VERSION.
 * Sadržaj mora pratiti stvarne UI labele (srpski) i stvarna ograničenja rola.
 */

export const GUIDE_VERSION = "1.0";
export const GUIDE_UPDATED_AT = "2026-08-23";

export type GuideSection = {
  id: string;
  title: string;
  route?: string;
  purpose: string;
  steps?: string[];
  notes?: string[];
};

export type GuideChapter = {
  id: string;
  title: string;
  audience: "SVI" | "VLASNIK" | "ZAPOSLENI";
  intro?: string;
  sections: GuideSection[];
};

export type QuickReferenceRow = {
  module: string;
  route: string;
  roles: string;
};

export type BusinessGuide = {
  version: string;
  updatedAt: string;
  title: string;
  subtitle: string;
  audienceNote: string;
  chapters: GuideChapter[];
  quickReference: QuickReferenceRow[];
};

export const businessGuide: BusinessGuide = {
  version: GUIDE_VERSION,
  updatedAt: GUIDE_UPDATED_AT,
  title: "LUMERA Biznis — Vodič za partnere",
  subtitle: "Detaljan priručnik za vlasnike salona i zaposlene",
  audienceNote:
    "Vodič je namenjen korisnicima sa poslovnim nalogom: vlasnicima salona (SALON_OWNER) i zaposlenima u salonu (SALON_EMPLOYEE). Dokument nije javan i dostupan je samo nakon prijave na poslovni nalog.",
  chapters: [
    {
      id: "uvod",
      title: "Uvod i osnove rada",
      audience: "SVI",
      intro:
        "Ovo poglavlje objašnjava prijavu, uloge, navigaciju i zajedničke elemente poslovnog dela LUMERA platforme.",
      sections: [
        {
          id: "prijava",
          title: "Prijava na poslovni nalog",
          route: "/poslovna-prijava",
          purpose:
            "Pristup poslovnom delu platforme (LUMERA Biznis) za vlasnike salona i zaposlene.",
          steps: [
            "Otvorite stranicu Poslovna prijava i unesite e-mail i lozinku poslovnog naloga.",
            "Nakon prijave sistem vas automatski vodi na početnu stranicu vaše uloge: vlasnik na Dashboard salona, zaposleni na Moj portal.",
            "Ako ste zaposleni i dobili ste privremenu lozinku, sistem će prvo tražiti da je promenite — bez toga portal ostaje zaključan.",
          ],
          notes: [
            "Odjava je uvek dostupna u gornjem desnom meniju (ikonica sa vašim inicijalima → Odjavi se).",
            "Link \"Nazad na Market\" vodi na javni deo platforme i ne odjavljuje vas.",
          ],
        },
        {
          id: "uloge",
          title: "Uloge i šta ko vidi",
          purpose:
            "Platforma razdvaja mogućnosti prema ulozi naloga: vlasnik salona upravlja celim salonom, a zaposleni radi samo sa svojim terminima i evidencijama.",
          notes: [
            "Vlasnik salona (SALON_OWNER): pun pristup vlasničkim modulima — kalendar, usluge, zaposleni, CRM, inventar, B2B prodavnica, porudžbine, automatizacije, paketi, program lojalnosti, performanse, pametni pomoćnik, profil salona i resursi.",
            "Zaposleni (SALON_EMPLOYEE): pristupa samo svom portalu (Moj portal) i poslovnim edukacijama; nema pristup owner modulima.",
            "Ako pokušate da otvorite stranicu koja nije za vašu ulogu, sistem vas preusmerava na vašu početnu stranicu.",
          ],
        },
        {
          id: "navigacija",
          title: "Navigacija i meni",
          purpose:
            "Gornja crna traka (LUMERA Biznis) je zajednička za sve poslovne korisnike i prilagođava se ulozi.",
          notes: [
            "Vlasnik u traci vidi prečice: Dashboard, Kalendar, Usluge, Zaposleni, Radno vreme, Zalihe, Shop, Porudžbine, Obaveštenja, Edukacije, kao i ikonice za obaveštenja i B2B korpu.",
            "Zaposleni u traci vidi: Moj portal i Edukacije.",
            "Stavka Pomoć otvara ovaj vodič u aplikaciji, sa dugmetom za preuzimanje PDF verzije.",
            "Na manjim ekranima meni se otvara dugmetom sa tri linije u gornjem desnom uglu.",
            "Na vlasničkoj kontrolnoj tabli postoji i bočni meni sa svim vlasničkim modulima: Kontrolna tabla, Kalendar, Usluge, Resursi, Profil salona, Zaposleni, CRM i zadržavanje klijenata, Automatizacije, Paketi tretmana, Performanse tima, Pametni pomoćnik, B2B oprema, Porudžbine, Obaveštenja, Program lojalnosti i Edukacije.",
          ],
        },
        {
          id: "aktivna-lokacija",
          title: "Više lokacija i aktivni salon (samo vlasnik)",
          purpose:
            "Vlasnik sa više salona/lokacija bira aktivnu lokaciju — svi owner moduli prikazuju podatke aktivne lokacije.",
          steps: [
            "U gornjoj traci otvorite padajuću listu \"Aktivni salon\" (vidljiva samo ako imate više od jedne lokacije).",
            "Izaberite lokaciju — aplikacija osvežava sve podatke i vraća vas na owner deo za izabranu lokaciju.",
          ],
          notes: [
            "Na dashboardu možete izabrati i prikaz \"Sve lokacije\" za zbirni pregled poslovanja (Učinak po lokaciji).",
          ],
        },
      ],
    },
    {
      id: "vlasnik",
      title: "Vodič za vlasnika salona",
      audience: "VLASNIK",
      intro:
        "Poglavlje pokriva sve module owner dashboarda redom kojim se pojavljuju u bočnom meniju. Za svaki modul su navedeni svrha, glavne akcije i preduslovi.",
      sections: [
        {
          id: "vl-dashboard",
          title: "Kontrolna tabla (Dashboard salona)",
          route: "/vlasnik",
          purpose:
            "Centralni pregled poslovanja aktivne lokacije: ključne metrike i današnji termini.",
          steps: [
            "Pregledajte kartice: Prihod (Ovaj mesec), Zakazivanja (Ovaj mesec), Novi klijenti i Loyalty status.",
            "U sekciji Današnji termini vidite raspored za danas; dugme \"Vidi kalendar\" vodi u pun kalendar.",
            "Ako imate više lokacija, prebacujte se između \"Aktivna lokacija\" i \"Sve lokacije\" — zbirni prikaz dodaje tabelu Učinak po lokaciji.",
          ],
          notes: [
            "Metrike se odnose na aktivnu lokaciju, osim u prikazu Sve lokacije.",
          ],
        },
        {
          id: "vl-kalendar",
          title: "Kalendar termina",
          route: "/vlasnik/kalendar",
          purpose:
            "Zakazivanje i vođenje svih termina salona: pregled po danu, izmene statusa, beleške i ponavljajuće serije.",
          steps: [
            "Izaberite datum da vidite raspored za taj dan.",
            "Kliknite \"Novi termin\" i izaberite klijenta (ili unesite walk-in klijenta), uslugu, zaposlenog, datum i vreme.",
            "Sistem prikazuje dostupnost — zauzeti termini se ne mogu duplo zakazati.",
            "Postojeći termin otvorite i preko \"Izmeni\" promenite status (npr. Potvrđen, Završen, Otkazan, No-show), pomerite ga ili dopišite belešku.",
            "Za redovne klijente možete zakazati seriju ponavljajućih termina (npr. nedeljno) i pregledati sve datume serije pre potvrde.",
          ],
          notes: [
            "Preduslov: da bi termin mogao da se zakaže, salon mora imati bar jednu uslugu i bar jednog zaposlenog kome je ta usluga dodeljena.",
            "Klijent dobija SMS/e-mail podsetnike prema podešavanjima automatizacija.",
            "Završeni termini automatski umanjuju zalihe proizvoda povezanih sa uslugom (vidi Inventar).",
          ],
        },
        {
          id: "vl-usluge",
          title: "Usluge salona",
          route: "/vlasnik/usluge",
          purpose:
            "Kreiranje i održavanje kataloga usluga: cene, trajanja, slike, resursi i potrošnja materijala.",
          steps: [
            "Na kartici \"Moje usluge\" kliknite \"Nova usluga ručno\" ili izaberite gotov šablon na kartici \"Biblioteka šablona\" pa \"Dodaj\".",
            "Unesite naziv, trajanje i cenu; po želji dodajte sliku usluge.",
            "U editoru usluge podesite potrošnju inventara (koji proizvod i koliko se troši po tretmanu) i potrebne resurse (npr. soba, aparat).",
            "Sačuvajte, a zatim u modulu Zaposleni dodelite uslugu zaposlenima koji je izvode.",
            "\"Izmeni\" i brisanje su dostupni na kartici svake usluge.",
          ],
          notes: [
            "Usluga postaje dostupna za online zakazivanje tek kada je aktivna i dodeljena bar jednom zaposlenom.",
            "Brisanje usluge ne briše istoriju već zakazanih termina.",
          ],
        },
        {
          id: "vl-resursi",
          title: "Resursi",
          route: "/vlasnik/resursi",
          purpose:
            "Upravljanje kapacitetima salona (sobe, stolice, aparati) koji ograničavaju koliko termina može da se odvija istovremeno.",
          steps: [
            "Kliknite \"Novi resurs\", unesite naziv i kapacitet, pa sačuvajte.",
            "U editoru usluge povežite uslugu sa resursom koji joj je potreban.",
          ],
          notes: [
            "Kada su svi kapaciteti resursa zauzeti, sistem sprečava preklapanje novih termina koji taj resurs zahtevaju.",
          ],
        },
        {
          id: "vl-profil",
          title: "Profil salona (Predstavljanje i dostupnost)",
          route: "/vlasnik/profil",
          purpose:
            "Javna prezentacija salona na marketu: opis, galerija, logo, radno vreme, objavljivanje profila i booking widget za vaš sajt.",
          steps: [
            "Popunite javne podatke salona i sačuvajte.",
            "Dodajte logo i fotografije u galeriju (do 20 fotografija); fotografije možete i ukloniti.",
            "Podesite dostupnost i objavite profil da bi salon bio vidljiv na marketu.",
            "U delu za widget pregledajte kako izgleda ugrađena forma zakazivanja i kliknite \"Kopiraj iframe kod\" da biste je postavili na sopstveni sajt.",
          ],
          notes: [
            "Preduslov za online zakazivanje i widget: profil mora biti popunjen i objavljen.",
            "Widget koristi isti sistem termina kao kalendar — nema duplog vođenja rasporeda.",
          ],
        },
        {
          id: "vl-zaposleni",
          title: "Zaposleni i usluge",
          route: "/vlasnik/zaposleni",
          purpose:
            "Upravljanje timom: dodavanje zaposlenih, nalozi za portal, dodela usluga i deaktivacija.",
          steps: [
            "Kliknite \"Dodaj zaposlenog\" i unesite podatke; zaposleni dobija nalog sa privremenom lozinkom koju menja pri prvoj prijavi.",
            "Na kartici zaposlenog dodelite usluge koje izvodi — samo dodeljene usluge se nude pri zakazivanju kod tog zaposlenog.",
            "\"Izmeni\" menja podatke i dodele; \"Deaktiviraj\" sklanja zaposlenog iz rasporeda bez brisanja istorije.",
          ],
          notes: [
            "Dodela usluga je isključivo u nadležnosti vlasnika — zaposleni ne mogu sami sebi dodeljivati usluge.",
            "Zahtevi za odsustvo i zamene smena zaposlenih odobravaju se u modulu Radno vreme (vidi ispod).",
          ],
        },
        {
          id: "vl-klijenti",
          title: "CRM & Retencija",
          route: "/vlasnik/klijenti",
          purpose:
            "Baza klijenata salona sa istorijom termina, segmentacijom i pokazateljima retencije (novi vs. vraćeni klijenti).",
          steps: [
            "Pretražite listu klijenata i otvorite \"Detalji\" za profil klijenta.",
            "U profilu vidite istoriju termina, beleške i fotografije tretmana (pre/posle) sačuvane uz saglasnost klijenta.",
            "Po potrebi dopunite podatke, npr. datum rođenja.",
            "Pratite segmente i statistike retencije za planiranje kampanja.",
          ],
          notes: [
            "Podaci klijenata su poverljivi — zaposleni vide samo klijente koje su sami usluživali, i to bez pune CRM istorije.",
          ],
        },
        {
          id: "vl-inventar",
          title: "Inventar (Zalihe)",
          route: "/vlasnik/inventar",
          purpose:
            "Kontrola zaliha proizvoda koji se troše kroz usluge i dopunjuju kroz B2B kupovinu.",
          steps: [
            "Pregledajte listu proizvoda sa stanjem; artikli sa niskim ili nultim stanjem su posebno označeni.",
            "\"Izmeni\" otvara unos količine i cene koštanja — sačuvajte korekciju stanja.",
            "Potrošnju po tretmanu podešavate u editoru usluge (modul Usluge).",
          ],
          notes: [
            "Kada se termin označi kao Završen, sistem automatski umanjuje zalihe prema podešenoj potrošnji usluge.",
            "Prijem B2B porudžbine dopunjuje zalihe povezanih artikala.",
          ],
        },
        {
          id: "vl-radno-vreme",
          title: "Radno vreme i zamene (Staff operations)",
          route: "/vlasnik/radno-vreme",
          purpose:
            "Evidencija radnog vremena tima (clock-in/clock-out), korekcije unosa i odlučivanje o zamenama smena.",
          steps: [
            "Izaberite period prečicama Danas, Ova nedelja ili Ovaj mesec.",
            "Pregledajte evidencije smena po zaposlenima; \"Koriguj\" otvara izmenu vremena, a \"Sačuvaj korekciju\" je upisuje (uz oznaku da je korigovao vlasnik).",
            "U delu za zamene smena odlučite o zahtevima koje je kolega već prihvatio: \"Odobri zamenu\" ili \"Odbij\".",
          ],
          notes: [
            "Tok zamene smene: zaposleni predloži → kolega prihvati/odbije → vlasnik odobri/odbije. Vlasnik odlučuje samo o zahtevima koji čekaju odobrenje vlasnika.",
            "Zahtevi za odsustvo zaposlenih se takođe odobravaju u owner delu; zaposleni ih šalje sa svog portala.",
          ],
        },
        {
          id: "vl-shop",
          title: "B2B Shop (Profesionalna oprema)",
          route: "/vlasnik/shop",
          purpose:
            "Veleprodajna kupovina profesionalnih proizvoda za salon, sa cenama po loyalty nivou.",
          steps: [
            "Pretražite proizvode (po imenu, brendu, opisu) i filtrirajte po brendu.",
            "Otvorite \"Detalji\" proizvoda, izaberite varijantu ako postoji i kliknite \"Dodaj u korpu\".",
            "Na stranici proizvoda možete ostaviti i ocenu/recenziju (\"Sačuvaj\").",
          ],
          notes: [
            "B2B shop je dostupan isključivo vlasnicima salona — zaposleni i kupci ga ne vide.",
            "Prikaz \"Nivo\" pokazuje vaš trenutni loyalty nivo koji određuje pogodnosti i cene.",
            "Dugme za korpu je onemogućeno za artikle bez zaliha.",
          ],
        },
        {
          id: "vl-checkout",
          title: "B2B korpa i naručivanje",
          route: "/vlasnik/prodavnica/korpa",
          purpose:
            "Završetak B2B kupovine u tri koraka: korpa → dostava i faktura → pregled i plaćanje.",
          steps: [
            "U korpi proverite artikle; količine menjate +/- kontrolama, a artikal uklanjate ikonicom za brisanje.",
            "Kliknite \"Nastavi na dostavu i fakturu\" i popunite sekcije Adresa isporuke i Podaci za račun.",
            "Kliknite \"Nastavi na pregled i plaćanje\", izaberite način plaćanja i potvrdite porudžbinu.",
            "Nakon uspešne porudžbine otvara se potvrda (\"Hvala vam na porudžbini!\") sa detaljima i brojem porudžbine.",
          ],
          notes: [
            "Ako se cena, dostupnost ili uslovi promene dok naručujete, sistem će tražiti da potvrdite osvežene iznose pre plaćanja — nikada ne naplaćuje ćutke drugačiji iznos.",
            "Ako korpu ispraznite u drugom tabu, checkout se bezbedno vraća na praznu korpu.",
          ],
        },
        {
          id: "vl-porudzbine",
          title: "B2B porudžbine",
          route: "/vlasnik/porudzbine",
          purpose:
            "Istorija i praćenje B2B porudžbina: statusi, detalji i praćenje pošiljke.",
          steps: [
            "Listajte porudžbine (Prethodna/Sledeća za stranice) i otvorite \"Detalji\".",
            "U detaljima pratite status i, kada je dostupno, kliknite \"Prati pošiljku\".",
          ],
          notes: [
            "Prijem porudžbine dopunjuje zalihe u Inventaru za povezane artikle.",
          ],
        },
        {
          id: "vl-obavestenja",
          title: "Obaveštenja",
          route: "/vlasnik/obavestenja",
          purpose:
            "Centralna lista poslovnih obaveštenja (porudžbine, termini, sistemske poruke) sa oznakom pročitano/nepročitano.",
          steps: [
            "Ikonica zvona u gornjoj traci prikazuje broj nepročitanih obaveštenja i vodi na listu.",
            "Otvorite obaveštenje — ako ima povezanu akciju (npr. porudžbinu), link vodi direktno na nju.",
          ],
        },
        {
          id: "vl-paketi",
          title: "Paketi tretmana",
          route: "/vlasnik/paketi",
          purpose:
            "Prodaja unapred plaćenih paketa (npr. 10 tretmana po nižoj ceni) i praćenje iskorišćenosti po klijentu.",
          steps: [
            "Kliknite \"Novi paket tretmana\", izaberite usluge na koje se paket odnosi, broj tretmana i cenu, pa sačuvajte.",
            "U delu \"Klijentski paketi\" pratite prodate pakete i preostale tretmane po klijentu.",
            "Pri završetku termina pokrivenog paketom sistem umanjuje preostali broj tretmana.",
          ],
          notes: [
            "Preduslov: bar jedna aktivna usluga. Paket važi samo za usluge izabrane pri kreiranju.",
            "Već prodati paket zadržava uslove pod kojima je prodat — naknadne izmene paketa ne menjaju kupljene pakete.",
          ],
        },
        {
          id: "vl-loyalty",
          title: "Loyalty program",
          route: "/vlasnik/loyalty",
          purpose:
            "Pregled vašeg loyalty statusa na platformi: trenutni nivo, pogodnosti i uslovi za više nivoe.",
          steps: [
            "Pregledajte trenutni nivo i pogodnosti, kao i tabelu \"Svi loyalty nivoi\".",
            "Dugme \"Poseti B2B Shop\" vodi u shop gde se pogodnosti primenjuju.",
          ],
          notes: [
            "Nivo se obračunava automatski na osnovu vaše kupovine — ne podešava se ručno.",
          ],
        },
        {
          id: "vl-automatizacije",
          title: "Marketing automatizacije",
          route: "/vlasnik/automatizacije",
          purpose:
            "Automatske kampanje prema klijentima (e-mail/SMS, vaučeri) sa statistikom učinka i atribucijom termina.",
          steps: [
            "Kliknite \"Kreirajte prvu automatizaciju\" (ili \"Izmeni\" na postojećoj).",
            "Podesite uslov okidanja (npr. neaktivnost klijenta), kanal (e-mail/SMS), sadržaj poruke i po želji vaučer.",
            "Pre aktivacije upotrebite test/probni prikaz da proverite koga bi kampanja obuhvatila.",
            "Aktivirajte, a kasnije pauzirajte/deaktivirajte ili obrišite po potrebi.",
            "U statistici birajte period (prečice ili prilagođeni opseg), pratite nove i vraćene klijente i listu termina pripisanih kampanji.",
          ],
          notes: [
            "Statistika i lista termina koriste ista pravila pripisivanja — brojevi se slažu za isti period.",
            "Slanje poruka zavisi od podešenih kanala (e-mail/SMS provajderi) na nivou platforme.",
          ],
        },
        {
          id: "vl-performanse",
          title: "Performanse tima",
          route: "/vlasnik/performanse",
          purpose:
            "Učinak po zaposlenom: broj tretmana, prihod, ocene i obračun provizije.",
          steps: [
            "Izaberite period (filteri datuma) i pregledajte tabelu \"Pregled po zaposlenima\".",
            "Otvorite \"Podešavanje provizije\" da za zaposlenog definišete procenat ili fiksni iznos.",
          ],
          notes: [
            "Zaposleni na svom portalu vidi samo sopstvene performanse — ne vidi kolege ni ceo salon.",
          ],
        },
        {
          id: "vl-ai",
          title: "Pametni pomoćnik",
          route: "/vlasnik/ai-asistent",
          purpose:
            "Poslovni asistent koji odgovara na pitanja o vašem salonu (promet, klijenti, trendovi) i pomaže u sastavljanju predloga.",
          steps: [
            "Upišite pitanje u polje \"Pitajte bilo šta o poslovanju vašeg salona...\" i pošaljite.",
            "Kada asistent ponudi predlog (npr. kampanju), možete ga otvoriti kao nacrt i potvrditi ili odustati (\"Odustani\").",
          ],
          notes: [
            "Asistent ne izvršava ništa bez vaše potvrde — nacrti se ne šalju klijentima automatski.",
            "Kvalitet odgovora zavisi od količine podataka u vašem salonu.",
          ],
        },
        {
          id: "vl-edukacije",
          title: "Edukacije (poslovne obuke)",
          route: "/biznis/edukacije",
          purpose:
            "Pregled i pohađanje stručnih edukacija; upis kursa i praćenje lekcija kroz Sistem za učenje.",
          steps: [
            "Pregledajte ponudu edukacija i otvorite detalje kursa.",
            "Nakon upisa, kurs pratite kroz Sistem za učenje (lekcije, materijali, napredak).",
          ],
          notes: [
            "Edukacije su dostupne i vašim zaposlenima; detalji pojedinačnog kursa pre upisa vidljivi su vlasniku.",
          ],
        },
        {
          id: "vl-nalog",
          title: "Nalog i odjava",
          purpose:
            "Upravljanje sesijom i nalogom iz gornje trake.",
          steps: [
            "Kliknite na svoje inicijale u gornjem desnom uglu.",
            "\"Dashboard\" vodi na kontrolnu tablu; \"Odjavi se\" bezbedno završava sesiju.",
          ],
        },
      ],
    },
    {
      id: "zaposleni",
      title: "Vodič za zaposlenog",
      audience: "ZAPOSLENI",
      intro:
        "Sve što zaposleni radi nalazi se na jednoj stranici — Moj portal (/zaposleni). Poglavlje prati sekcije portala redom.",
      sections: [
        {
          id: "za-portal",
          title: "Moj portal — pregled",
          route: "/zaposleni",
          purpose:
            "Lična početna stranica: današnji raspored, brze akcije i statistika (Ove nedelje, Ovog meseca, Završeni, No-show).",
          steps: [
            "U zaglavlju su brze akcije \"Moj profil\" i \"Zakaži termin\".",
            "U kalendaru (\"Izaberite datum\") birate dan; prečice Danas, Sutra i Prekosutra menjaju datum jednim klikom.",
          ],
          notes: [
            "Portal prikazuje isključivo termine koji su dodeljeni vama — ne vidite raspored kolega.",
          ],
        },
        {
          id: "za-profil",
          title: "Moj profil",
          purpose:
            "Lični podaci koje klijenti i salon vide: fotografija, opis i kontakt telefon.",
          steps: [
            "Kliknite \"Moj profil\" u zaglavlju portala.",
            "Promenite fotografiju (\"Izaberi fotografiju\"), Opis i Kontakt telefon.",
            "Kliknite \"Sačuvaj profil\".",
          ],
          notes: [
            "Ime, e-mail i ulogu menja vlasnik — ta polja ovde nisu izmenjiva.",
          ],
        },
        {
          id: "za-termini",
          title: "Moji termini",
          purpose:
            "Dnevni raspored vaših termina sa podacima o klijentu, usluzi, vremenu, beleškama i statusom (Na čekanju, Potvrđen, Završen, Otkazan, No-show).",
          steps: [
            "Izaberite dan u kalendaru — lista \"Moji termini\" prikazuje raspored poređan po vremenu.",
            "Na aktivnom terminu kliknite \"Završi / no-show\".",
            "U dijalogu \"Ažuriraj termin\" izaberite status Završen ili No-show, po želji dopišite internu napomenu i kliknite \"Sačuvaj\".",
          ],
          notes: [
            "Možete menjati samo sopstvene termine, i to samo prelaz u Završen ili No-show — otkazivanja i pomeranja radi salon.",
            "Termini iz serije nose oznaku \"Serija\".",
            "Kod klijenta vidite ime, telefon i interne napomene — bez pune CRM istorije salona.",
          ],
        },
        {
          id: "za-fotografije",
          title: "Fotografije pre/posle tretmana",
          purpose:
            "Čuvanje fotografija rezultata tretmana u CRM profil klijenta — isključivo uz saglasnost klijenta.",
          steps: [
            "Na završenom terminu kliknite \"Pre/posle fotografije\".",
            "U dijalogu \"Fotografije tretmana\" izaberite vrstu: Pre tretmana ili Posle tretmana, pa izaberite fotografiju.",
            "Označite obaveznu potvrdu: \"Klijent je saglasan sa fotografisanjem i čuvanjem fotografija.\"",
            "Kliknite \"Sačuvaj fotografiju\".",
          ],
          notes: [
            "Bez potvrđene saglasnosti dugme za čuvanje ostaje nedostupno — saglasnost se proverava i na serveru.",
            "Fotografije vidite samo za sopstvene termine.",
          ],
        },
        {
          id: "za-zakazivanje",
          title: "Zakazivanje termina i serija",
          purpose:
            "Zakazivanje novog termina za klijenta koga ste ranije uslužili ili za novog gosta, uključujući ponavljajuće serije.",
          steps: [
            "Kliknite \"Zakaži termin\" u zaglavlju portala.",
            "Izaberite Uslugu (nude se samo usluge koje su vam dodeljene).",
            "Izaberite klijenta iz liste \"Klijent kog ste ranije uslužili\" ili preko \"Brzi unos novog klijenta\" unesite Ime, Prezime, Telefon i po želji Email.",
            "Izaberite datum i vreme — sistem za svaki predlog prikazuje \"Slobodno\" ili \"Konflikt\".",
            "Za seriju označite \"Zakaži seriju termina\", izaberite ritam (Svaki dan, Svaka 2 dana, Svaka 3 dana, Nedeljno, Na 2 nedelje, Mesečno) i broj ponavljanja (1–24), pa \"Primeni\" i \"Proveri\".",
            "Potvrdite dugmetom \"Zakaži termin\" / \"Zakaži seriju\".",
          ],
          notes: [
            "Termine zakazujete samo kod sebe — ne možete zakazivati kolegama.",
            "Iz postojeće baze birate samo klijente koje ste ranije uslužili; ostale klijente salona ne vidite.",
          ],
        },
        {
          id: "za-radno-vreme",
          title: "Evidencija radnog vremena (clock-in/clock-out)",
          purpose:
            "Beleženje početka i kraja smene i pregled sopstvenih evidencija.",
          steps: [
            "U sekciji \"Evidencija radnog vremena\" kliknite \"Započni smenu\" kada počnete rad.",
            "Na kraju rada kliknite \"Završi smenu\".",
            "Pratite zbirove \"Ove nedelje\" i \"Ovog meseca\" i listu poslednjih unosa.",
          ],
          notes: [
            "Beležite samo sopstvene smene. Ako vlasnik ispravi unos, pored njega stoji oznaka \"korigovao vlasnik\".",
          ],
        },
        {
          id: "za-zamene",
          title: "Zamena smene",
          purpose:
            "Dogovor zamene smene sa kolegom uz obavezno odobrenje vlasnika.",
          steps: [
            "U sekciji \"Zamena smene\" izaberite kolegu (\"Izaberite kolegu\"), datum i po želji napomenu, pa kliknite \"Predloži\".",
            "Kada vama stigne tuđi predlog, odgovorite sa \"Prihvati\" ili \"Odbij\".",
            "Svoj neodlučeni zahtev možete povući dugmetom \"Otkaži moj zahtev\".",
          ],
          notes: [
            "Statusi zahteva: Čeka kolegu → Čeka odobrenje vlasnika → Odobreno; mogući su i Kolega je odbio, Vlasnik je odbio i Otkazano.",
            "Zamena važi tek kada je vlasnik odobri.",
          ],
        },
        {
          id: "za-odsustva",
          title: "Radno vreme i zahtevi za odsustvo",
          purpose:
            "Pregled sopstvenog nedeljnog radnog vremena i slanje zahteva za odsustvo.",
          steps: [
            "U sekciji \"Moje radno vreme\" proverite raspored po danima (sa pauzama).",
            "Kliknite \"Pošalji zahtev za odsustvo\", unesite polja Od, Do i Razlog, pa \"Pošalji zahtev\".",
            "Pratite svoje zahteve u listi \"Odsustva i zahtevi\" sa statusima Na čekanju, Odobreno ili Odbijeno.",
          ],
          notes: [
            "O zahtevima odlučuje vlasnik — vi ne možete odobravati odsustva.",
          ],
        },
        {
          id: "za-performanse",
          title: "Moje performanse",
          purpose:
            "Lične metrike rada: broj odrađenih tretmana, prosečna ocena, procenjena provizija, prihod od termina i rebooking stopa.",
          steps: [
            "U sekciji \"Moje Performanse\" izaberite period: Ovaj mesec, Prošli mesec ili Poslednjih 30 dana.",
            "Pregledajte metrike: Odrađeno tretmana, Prosečna ocena, Procenjena provizija, Ukupan prihod od termina, Rebooking rate.",
          ],
          notes: [
            "Vidite isključivo sopstvene rezultate — pregled celog tima ima samo vlasnik.",
            "Provizija se računa po pravilu koje je vlasnik podesio (procenat ili fiksno).",
          ],
        },
        {
          id: "za-ostalo",
          title: "Obaveštenja, moje usluge i edukacije",
          purpose:
            "Prateće sekcije portala i pristup poslovnim edukacijama.",
          notes: [
            "Obaveštenja: novi dodeljeni termini i podsetnici za sutra; kada nema novih, piše \"Nemate nova obaveštenja.\"",
            "Moje usluge: lista usluga koje su vam dodeljene sa trajanjem; dodelu menja vlasnik.",
            "Edukacije: preko stavke Edukacije u gornjoj traci pristupate poslovnim obukama i Sistemu za učenje za kurseve na koje ste upisani.",
            "Nalog: odjava je u meniju sa inicijalima u gornjem desnom uglu.",
          ],
        },
        {
          id: "za-ogranicenja",
          title: "Šta zaposleni NEMA na platformi",
          purpose:
            "Jasne granice pristupa za nalog zaposlenog — ovo nije kvar, već pravilo platforme.",
          notes: [
            "Nema pristup vlasničkim modulima: CRM i zadržavanje klijenata, Inventar, B2B prodavnica i B2B korpa/porudžbine, Automatizacije, Paketi tretmana, podešavanja programa lojalnosti, Performanse tima, pametni pomoćnik, Resursi, Profil salona i Upravljanje zaposlenima.",
            "Ne vidi raspored ni performanse kolega, niti kompletnu bazu klijenata salona.",
            "Ne može da otkazuje ili pomera termine kroz portal (samo Završen/No-show na svojim terminima).",
            "Ne odobrava odsustva, zamene smena (finalno odobrenje) niti koriguje evidenciju radnog vremena.",
            "Pokušaj otvaranja owner adresa (npr. /vlasnik) automatski vraća zaposlenog na njegov portal.",
          ],
        },
      ],
    },
  ],
  quickReference: [
    { module: "Kontrolna tabla", route: "/vlasnik", roles: "Vlasnik" },
    { module: "Kalendar termina", route: "/vlasnik/kalendar", roles: "Vlasnik" },
    { module: "Usluge salona", route: "/vlasnik/usluge", roles: "Vlasnik" },
    { module: "Resursi", route: "/vlasnik/resursi", roles: "Vlasnik" },
    { module: "Profil salona i widget", route: "/vlasnik/profil", roles: "Vlasnik" },
    { module: "Zaposleni i usluge", route: "/vlasnik/zaposleni", roles: "Vlasnik" },
    { module: "CRM & Retencija", route: "/vlasnik/klijenti", roles: "Vlasnik" },
    { module: "Inventar (Zalihe)", route: "/vlasnik/inventar", roles: "Vlasnik" },
    { module: "Radno vreme i zamene", route: "/vlasnik/radno-vreme", roles: "Vlasnik" },
    { module: "B2B Shop", route: "/vlasnik/shop", roles: "Vlasnik" },
    { module: "B2B korpa i checkout", route: "/vlasnik/prodavnica/korpa", roles: "Vlasnik" },
    { module: "B2B porudžbine", route: "/vlasnik/porudzbine", roles: "Vlasnik" },
    { module: "Obaveštenja", route: "/vlasnik/obavestenja", roles: "Vlasnik" },
    { module: "Paketi tretmana", route: "/vlasnik/paketi", roles: "Vlasnik" },
    { module: "Loyalty program", route: "/vlasnik/loyalty", roles: "Vlasnik" },
    { module: "Automatizacije", route: "/vlasnik/automatizacije", roles: "Vlasnik" },
    { module: "Performanse tima", route: "/vlasnik/performanse", roles: "Vlasnik" },
    { module: "Pametni pomoćnik", route: "/vlasnik/ai-asistent", roles: "Vlasnik" },
    { module: "Moj portal", route: "/zaposleni", roles: "Zaposleni" },
    { module: "Edukacije", route: "/biznis/edukacije", roles: "Vlasnik i zaposleni" },
    { module: "Vodič (Pomoć)", route: "/biznis/vodic", roles: "Vlasnik i zaposleni" },
  ],
};
