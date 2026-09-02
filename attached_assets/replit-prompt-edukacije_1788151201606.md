# PROMPT ZA REPLIT AGENT — Modul "Edukacije" (Beauty-Partner-Hub)

## ⚠️ VAŽNO — PROČITAJ PRE BILO KAKVIH IZMENA

Pre nego što implementiraš bilo šta od ovoga, prvo pretraži postojeći kod i bazu (replId `6b6c8a4c-09a1-427b-b1ad-9e4e1d89549a`) i proveri da li već postoji:

- Sistem monetizacije/pretplate za "Istaknut salon" (IPS QR generisanje računa + automatsko poklapanje po pozivu na broj)
- Booking/rezervacioni sistem (kalendar, multi-employee, cancelation/no-show logika)
- Jobs marketplace modul
- Bilo koja postojeća tabela, ruta ili UI komponenta vezana za edukacije/kurseve

**Ako nešto od ovoga već postoji — NEMOJ ga ponovo praviti, brisati ili prepisivati od nule. Samo proširi/doradi postojeće komponente.** Konkretno: ceo mehanizam plaćanja (IPS QR + poziv na broj + automatska aktivacija) za "Istaknut salon" treba da se **iskoristi identično** za monetizaciju edukativnog dela — ne pravi paralelni sistem plaćanja. Isto važi za bilo koji postojeći layout/komponente za liste i kartice (npr. kartice salona) — proveri da li se mogu ponovo iskoristiti za kartice edukativnih centara i kurseva pre nego što praviš nove od nule.

---

## 1.1. NAPOMENA O NADOGRADNJI (VAŽI ZA CEO DOKUMENT)

Sve što je ispod navedeno je **dopuna i proširenje** postojeće specifikacije, ne zamena. Ako je nešto od ranije već implementirano (baza, UI, monetizacija, taksonomija) — **ne brisati, ne prepravljati iznova, samo nadograditi/dopuniti** poljima i sekcijama navedenim ispod. Ovo se posebno odnosi na tabelu `education_courses` i stranicu detalja kursa — dodati nova polja, ne menjati postojeću strukturu koja već radi.

## 1. KONTEKST I SVRHA MODULA

Modul "Edukacije" je deo business strane platforme (nije vidljiv običnim korisnicima/klijentima salona — samo salonima, edukativnim centrima i administratorima, u skladu sa postojećom podelom customer/business strane). Edukativni centri objavljuju kurseve (uživo, online ili hibridno), a saloni i pojedinci ih pretražuju i šalju upite/rezervišu.

---

## 2. TAKSONOMIJA — 24 GLAVNE KATEGORIJE, GRUPISANE U 6 SEKCIJA

Ovo je hijerarhija: **Sekcija → Kategorija → Potkategorija → Tip kursa (predefinisan, ali proširiv)**.

### SEKCIJA: LICE I TELO

**1. KOZMETIČAR I NEGA LICA**
- Osnove: Osnovni kurs, Napredni kurs, Estetičar, Anatomija i fiziologija kože, Dermatologija, Kozmetologija (moguć zaseban modul: samo kozmetika lica)
- Dijagnostika: Analiza kože, Konsultacija sa klijentom, Prepoznavanje kožnih promena
- Čišćenje: Higijenski tretman, dubinsko čišćenje, manualno čišćenje
- Po tipu kože: Masna, suva, osetljiva, dehidrirana, problematična, sklona aknama, Mature skin protocols, Sensitive skin protocols
- Anti-age/tonus: Anti-age tretmani, hiperpigmentacija, blistavost kože, hidratacija, učvršćivanje kože, facial lifting
- Pilinzi: Profesionalni piling, enzimski piling, AHA/BHA kiseline, Dermaplaning
- Maske/serumi: Alginatne maske, profesionalne maske i serumi, Facial massage, Spa facial
- Korektivno: Camouflage makeup (ožiljci, vitiligo, rozaceja)

**2. APARATURNI TRETMANI LICA**
- Mehanika/vakuum: Mikrodermoabrazija, Hidrodermoabrazija, Hydrofacial/Aqua Peel, Ultrasonic skin scrubber
- Struje: Ultrazvuk lica, Sonoforeza, Galvanska struja, Jonoforeza, Elektroporacija, No-needle mezoterapija, EMS/mikrostruje za lice, Microcurrent facial, High Frequency facial
- RF/HIFU: Radiofrekvencija lica, Multipolarna RF, Bipolarna RF, HIFU lica
- Mikroigličasto: Dermapen, Microneedling, Nano-needling, BB Glow, RF microneedling
- Fototerapija: LED fototerapija, Oxygen facial, Oxygen infusion, Cold plasma, Cryo facial
- Kombinovanje aparaturnih tretmana

**3. APARATURNI TRETMANI TELA**
- Kavitacija/RF: Kavitacija, Ultrazvučna kavitacija, Radiofrekvencija tela, Vakuum + RF
- Limfna/vakuum: Vakuum terapija, Presoterapija, Aparaturna limfna drenaža, LPG/endermologija
- Elektrostimulacija: EMS, Elektrostimulacija, HIFEM/Body Sculpt
- Termalna: Kriolipoliza, Lipolaser, Infrared body treatments, HIFU tela
- Body contouring, Cellulite reduction, Kreiranje body sculpting protokola

**4. DEPILACIJA I UKLANJANJE DLAKA**
- Vosak: Klasična depilacija voskom, topli vosak, hladni vosak, Film/Hard Wax, Soft Wax
- Po delu tela: Depilacija lica, depilacija tela, intimna depilacija, brazilska depilacija, muška depilacija
- Šećer/threading: Sugaring, šećerna pasta, Threading
- Laser/IPL: IPL epilacija, diodni laser, aleksandritni laser, Nd:YAG laser, laserska epilacija, elektroliza/electrolysis

### SEKCIJA: NOKTI I STOPALA

**5. MANIKIR I NOKTI**
- Klasične tehnike: Osnovni manikir, klasični, ruski, kombinovani, aparaturni, japanski, spa manikir, E-file tehnika, poravnavanje ploče nokta
- Nadogradnja: Gel lak, Rubber base, BIAB/Builder Gel, gel tehnika, akril, Polygel/Acrygel, nadogradnja tipsama, dual forms, korekcija noktiju, profesionalno uklanjanje materijala
- Oblici: Nail architecture, salon shapes (Almond, Square, Ballerina, Stiletto), French tehnike, Baby boomer
- Nail art: Nail art, 3D nail art, Chrome, Ombre, stamping nail art
- Nega: Problematični nokti, parafinska terapija za ruke

**6. PEDIKIR I PODOLOGIJA**
- Klasične tehnike: Klasični pedikir, estetski, spa, aparaturni, kombinovani, pedikir sa gel lakom, parafinska terapija za stopala
- Medicinski: Rekonstrukcija nokta, problematična stopala, žuljevi i hiperkeratoza, kurje oko, pukotine na petama, urasli nokti, korektivne tehnike za nokte
- Podologija: Ortoniksija, osnove podologije, napredna podologija

### SEKCIJA: OČI I OBRVE

**7. TREPAVICE**
- Klasika/volumen: Klasična nadogradnja 1:1, 2D, 3D, 4D-6D, Volume Lashes, Russian Volume, Mega Volume, Hybrid Lashes
- Stilske tehnike: Wispy Lashes, Wet Look, Kim K effect, Eyeliner effect, Fox Eye, Cat Eye, Doll Eye, Anime/Manga lashes
- Mapiranje/styling: Lash Mapping, Advanced Lash Mapping, Lash Styling
- Lift/boja: Lash Lift, Korean Lash Lift, farbanje trepavica, uklanjanje boje
- Korekcija/uklanjanje: Korekcija ekstenzija, bezbedno uklanjanje ekstenzija
- Lash educator/master program

**8. OBRVE**
- Oblikovanje: Oblikovanje obrva, Brow Mapping, Advanced Brow Mapping, Threading obrva, depilacija obrva
- Boja: Farbanje obrva, Henna Brows, Hybrid Dye Brows, Airbrush Brows, uklanjanje boje
- Lifting: Brow Lamination, Brow Lift, Brow Styling
- Korekcija/asimetrija obrva

**9. TRAJNA ŠMINKA (PMU)**
- Obrve: Osnove PMU, Microblading, Nano Brows, Hair Stroke Brows, Powder Brows, Microshading, Ombre Brows, Shading, Combo Brows, Hybrid Brows
- Oči: Permanent Eyeliner, Classic Eyeliner, Shaded Eyeliner, Lash Enhancement
- Usne: Permanent Lips, Lip Blush, Aquarelle Lips, Full Lip Colour, neutralizacija tamnih usana
- Teorija: Color Theory, Pigmentology, korekcija starog PMU
- Uklanjanje: PMU Removal, Saline Removal, Laser PMU Removal, Nano Removal
- Specijalizovano: Scalp Micropigmentation, Areola Micropigmentation, Scar Camouflage, Paramedical Tattooing

### SEKCIJA: KOSA I STILING

**10. FRIZER**
- Šišanje: Osnovni kurs za frizera, žensko šišanje, muško šišanje, dečje šišanje, napredne tehnike šišanja
- Nega kovrdžave kose: Suvo šišanje (dry cut), Curly Girl Method, buđenje kovrča (piling vlasišta + hidratacija), afro i talasasta kosa, dijagnostika tipa kovrdže
- Stilizovanje: Feniranje, Blow Dry, stilizovanje kose, lokne, talasi, Hollywood Waves
- Svečano/pletenice: Svečane frizure, Bridal Hair, Updo, pletenice, afro pletenice
- Ekstenzije/perike: Hair Extensions, Tape-in extensions, Keratin extensions, Microring, Wigs & Hairpieces (uklj. medicinske perike za onkološke pacijente)
- Nega/trihologija: Keratinski tretmani, Hair Botox, Hair Reconstruction, Scalp Care, Head Spa, trihologija/dijagnostika opadanja kose
- Koloristika osnovna: Osnove koloristike, farbanje, toniranje, bleaching, color correction
- Koloristika napredna: Napredna koloristika, Balayage, Ombre, Sombre, Highlights, Babylights, AirTouch, Foilyage, Creative Color

**11. BARBER**
- Šišanje/fade: Osnovni barber kurs, muško šišanje, Fade, Skin Fade, Taper Fade, Scissor Cutting, Clipper Cutting
- Brada: Beard Trimming, Beard Styling, Hair & Beard Design
- Brijanje: Hot Towel Shave, Classic Shaving, Razor Techniques
- Napredno/biznis: Barber Styling, Advanced Barber, Barber Shop Management

**12. ŠMINKANJE / MAKEUP**
- Osnove: Osnovni kurs šminkanja, Self Makeup, Profesionalni Makeup Artist program, Color Theory, Face Shapes & Contouring
- Dnevni/večernji: Dnevna šminka, večernja šminka, Glam Makeup, Soft Glam, Smokey Eyes, Cut Crease
- Prigodni: Bridal Makeup (+ Bridal Makeup Business), Matursko šminkanje, Dečije/party makeup, Halloween/Carnival makeup
- Specijalizovano: Mature Skin Makeup, makeup za problematičnu kožu, makeup za muškarce
- Produkcija: Makeup za fotografisanje, Fashion Makeup, Editorial Makeup, TV/Film Makeup, HD Makeup, Airbrush Makeup
- SFX/body art: SFX/Special Effects Makeup, Face Painting, Body Painting

**13. LIČNI STILING I IMIDŽ**
- Personal styling / imidž konsultant
- Analiza tipa figure i boja (color analysis)
- Wardrobe konsalting
- Styling za fotografisanje/venčanje

### SEKCIJA: TELO I WELLNESS

**14. MASAŽA**
- Klasične/relax: Klasična masaža, Relax masaža, Švedska masaža, Spa masaža
- Terapeutsko/sportsko: Terapeutska masaža, Sportska masaža, Sportska rehabilitacija, Kinesio taping, Myofascial tehnike, Trigger point tehnike
- Modelovanje tela: Anticelulit masaža, Limfna drenaža, Manuelna limfna drenaža, Maderoterapija, Brazilska maderoterapija, Maderoterapija lica, Vakuum masaža, Cupping masaža, Hot Stone masaža
- Orijentalne/tradicionalne: Aromaterapijska masaža, Ayurvedska masaža, Lomi Lomi masaža, Thai masaža, Shiatsu, Bamboo masaža, Masaža biljnim/herbal vrećicama, Tantra/senzualna masaža
- Pritisak/refleksne tačke: Akupresura, Refleksologija, Masaža stopala, Masaža glave, Indian Head Massage, Gua Sha masaža
- Lice: Masaža lica, Kobido masaža lica, Buccal/intraoralna masaža lica, Sculptural Face Lifting
- Posebne grupe: Prenatalna masaža, Postnatalna masaža, Masaža za bebe, Masaža dece, Watsu, Craniosacral tehnike, Prenatalna masaža sa loptom
- Vrat/leđa: Masaža vrata i ramena, Masaža leđa

**15. SPA & WELLNESS**
- Spa terapeut: Spa Therapist, Wellness Therapist, Holistic Therapy, Spa Management
- Body rituali: Body Scrub, Body Peeling, Body Wrap, Mud Therapy, Chocolate Therapy
- Vodeno/toplotno: Hydrotherapy, Thalassotherapy, Marinotherapy, Sauna Rituali, Hammam Treatments, bazenski wellness rituali
- Banjska terapija: Balneoterapija, Peloidoterapija (mineralno/mulj)
- Napredni wellness aparati: Kriokomora (whole-body cryotherapy), Ozon terapija
- Aromatherapy, Herbal Treatments
- Spa Facial, Spa Massage, detox programi

**16. TANNING & BEAUTY SPECIALTIES**
- Bronzing: Spray Tan, Airbrush Tan, Professional Self-Tanning, Solarijum (rad sa UV kabinama)
- Sitni detalji: Body Makeup, Tooth Gems, Teeth Whitening, Ear Piercing, Beauty Spot/Faux Freckles
- Azijski trendovi: Head Spa, Japanese Head Spa, Korean Beauty Treatments, K-Beauty Facial, Glass Skin tretmani

**17. ALTERNATIVNA I ENERGETSKA WELLNESS TERAPIJA**
- Energetske tehnike: Reiki I, Reiki II, Reiki Master, Bioenergija, Kristaloterapija
- Zvuk/relaksacija: Sound Healing, Gong terapija, meditacija — vođenje, mindfulness
- Rad sa telom/prostorom: Čakra balansiranje, energetsko čišćenje prostora

**18. INSTRUKTORSKI PROGRAMI POKRETA**
- Instruktor joge (osnovni/napredni)
- Instruktor pilatesa
- Instruktor disanja/relaksacije

### SEKCIJA: POSLOVANJE I ZANAT

**19. TETOVAŽA I BODY ART**
- Osnove: Osnovni Tattoo Artist, higijena i bezbednost, Tattoo Machine Techniques, Tattoo Design
- Stilovi: Fine Line Tattoo, Tiny Tattoo, Blackwork, Linework, Shading, Dotwork, Realism, Micro Realism, Black & Grey, Color Tattoo, Traditional, Neo Traditional, Geometric Tattoo, Lettering
- Uklanjanje/korekcija: Tattoo Removal, Scar Camouflage, Stretch Mark Camouflage
- Piercing: Ear Piercing, Body Piercing, Microdermal implants, aftercare edukacija

**20. IZRADA PRIRODNE/ORGANSKE KOZMETIKE**
- Osnove formulacije: Kozmetička hemija za početnike, HLB sistem, konzervansi i bezbednost proizvoda
- Napredna formulacija: Napredni kurs (za one koji već proizvode), kombinovanje višestrukih formulacija
- Kreme i emulzije: Izrada dvofazne/jednofazne kreme, losioni, puteri za telo
- Sapuni: Hladan postupak, glicerinski sapuni, ukrašavanje sapuna
- Fitokozmetika: Maceracija, melemi, biljna ulja, hidrolati, ekstrakti lekovitog bilja
- Aromaterapija (proizvodnja): Eterična ulja, mešanje mirisa, tonici za lice, dezodoransi
- Regulativa i poslovanje: Zakonska regulativa/deklarisanje proizvoda (EU usklađenost), nabavka sirovina, prodaja i marketing sopstvene kozmetike

**21. BEAUTY BUSINESS & MENADŽMENT**
- Pokretanje biznisa: Kako otvoriti beauty salon, Salon Management, Beauty Entrepreneurship, Business Plan
- Finansije: Formiranje cena, kalkulacija troškova, profitabilnost tretmana, finansije za beauty salon, osnove knjigovodstva, porezi i administracija
- Operativno: Upravljanje zalihama, nabavka proizvoda, upravljanje terminima, Online Booking, No-show management
- Kadrovi: Upravljanje zaposlenima, zapošljavanje, motivacija zaposlenih, organizacija smena, SOP procedure
- Klijenti: Customer Experience, Customer Service, CRM za beauty salon, retention klijenata, loyalty programi, upselling, cross-selling
- Rast: Kreiranje paketa tretmana, membership modeli, KPI za salon, skaliranje salona, otvaranje više lokacija

**22. MARKETING ZA BEAUTY BIZNIS**
- Osnove: Osnove marketinga za beauty, personal branding, branding salona
- Društvene mreže: Instagram za beauty salon, TikTok za beauty biznis, Facebook marketing, Reels za beauty salon, TikTok video produkcija
- Plaćeno oglašavanje: Meta Ads, Instagram Ads, Google Ads, Google Business Profile
- SEO/reputacija: Lokalni SEO, SEO za beauty salon, Google recenzije, Reviews & Reputation Management
- Sadržaj: Content Marketing, Content Creation, Canva za beauty biznis, fotografisanje tretmana i Before/After, video editing, copywriting, storytelling
- Direktni marketing: Email Marketing, SMS Marketing, CRM Marketing, remarketing, lead generation
- Analitika: Marketing automatizacija, analitika i praćenje konverzija

**23. EDUKATORI / TRAIN THE TRAINER**
- Kako postati beauty edukator, Train the Trainer, Teaching Certificate
- Kreiranje beauty edukacije, metodologija predavanja, praktična demonstracija, rad sa polaznicima
- Organizacija praktične nastave, ocena znanja polaznika, mentorstvo
- Kreiranje priručnika, prezentacija, online kursa, snimanje online edukacije, prodaja online kurseva
- Organizacija masterclass-a, radionica, Personal Branding za edukatore, marketing beauty edukacija, Academy Management

**24. HIGIJENA, BEZBEDNOST I PROFESIONALNI STANDARDI**
- Higijena/sterilizacija: Higijena u beauty salonu, dezinfekcija, sterilizacija, Infection Control, Bloodborne Pathogens
- Bezbednost: Bezbednost na radu, profesionalna higijena, prva pomoć
- Znanje: Anatomija i fiziologija, dermatologija za beauty profesionalce, kontraindikacije, prepoznavanje reakcija kože, alergijske reakcije, Patch Testing
- Bezbednost materijala: Bezbedna upotreba kozmetičkih proizvoda, Chemical Safety, Electrical Safety, bezbednost aparaturnih tretmana
- Dokumentacija: Konsultacija sa klijentom, anamneza, Consent Forms, evidencija tretmana, aftercare, profesionalna etika

---

## 3. BAZA PODATAKA — NOVE TABELE (dodati, ne menjati postojeće)

```
education_sections (id, naziv, redosled)
education_categories (id, section_id, naziv, ikonica, redosled)
education_subcategories (id, category_id, naziv, redosled)
education_course_types (id, subcategory_id, naziv, status[odobreno/na_cekanju], predlozio_centar_id)
education_courses (id, course_type_id, centar_id, naziv, opis, cena, trajanje,
                    format[uzivo/online/hibridno], lokacija, nivo[pocetni/napredni/profesionalni],
                    akreditovano[da/ne], status)
education_course_tags (course_id, tag)  -- za kurseve koji seku više oblasti (npr. "Bridal Hair & Makeup")
education_centers (id, naziv, kontakt, datum_pridruzivanja, prosecna_ocena, broj_recenzija)
education_center_reviews (id, centar_id, korisnik_id, ocena, komentar, datum)
education_inquiries (id, course_id, korisnik_id, centar_id, datum, status)
education_center_metrics (centar_id, broj_upita_30d, broj_upita_90d, broj_pregleda_30d)
education_featured_placements (id, centar_id ili course_id, tip[istaknuto/specijalna_ponuda],
                                page_scope[home/category/subcategory], scope_id,
                                pozicija, cena, datum_od, datum_do, invoice_id)
```

---

## 4. MONETIZACIJA (reuse postojećeg IPS QR flow-a — ne praviti novi sistem plaćanja)

- **Osnovna vidljivost/listing kursa** — mesečna ili godišnja pretplata, isti IPS QR + poziv na broj flow kao "Istaknut salon"
- **Istaknuti edukativni centri** i **Specijalne ponude** — plaćene pozicije po slotu (npr. pozicija 1/2/3), cenovnik zavisi od nivoa stranice (početna Edukacije / nivo kategorije / nivo potkategorije) — takođe kroz IPS QR
- **Provizija** — samo za kurseve gde korisnik plaća kroz platformu (online kursevi ILI uživo kursevi sa obaveznim depozitom naplaćenim kroz platformu). Za uživo kurseve sa gotovinskim plaćanjem NEMA provizije — samo pretplata za listing.

---

## 4.1. DETALJNA STRANICA KURSA — DODATNA POLJA (nadograditi postojeću, ne praviti novu)

Ako stranica detalja kursa već postoji, dodati sledeća polja/sekcije (ne brisati postojeće):

- **Trajanje** — tekstualno polje (npr. "3 dana", "2 nedelje", "4 meseca") + opciono broj časova teorije/prakse
- **Nivo** — Početnik / Srednji nivo / Napredni / Za profesionalce
- **Sertifikat** — naziv sertifikata + da li je akreditovan (već postoji polje `akreditovano`, ovde samo prikaz na stranici)
- **Šta ćete naučiti** — lista bullet-tačaka (npr. "Samostalan rad sa klijentima", "Pravilna primena tehnike", "Organizacija profesionalnog tretmana") — centar unosi slobodan broj stavki
- **Uključeno u cenu** — lista bullet-tačaka (npr. "Radni materijal", "Sertifikat", "Podrška mentora", "Skripta/literatura")
- **Preduslovi** — slobodan tekst (npr. "Nije potrebno prethodno iskustvo. Ponesite beleške i dođite 15 minuta ranije.")

Baza — dodati nova polja u postojeću (ili novu, ako ne postoji) tabelu `education_courses`, i dve prateće tabele za liste promenljive dužine:

```
education_courses — dodati kolone:
    trajanje_tekst, broj_casova_teorije, broj_casova_prakse,
    nivo[pocetnik/srednji/napredni/profesionalac],
    naziv_sertifikata, preduslovi_tekst

education_course_learning_points (id, course_id, tekst, redosled)   -- "Šta ćete naučiti"
education_course_included_items (id, course_id, tekst, redosled)   -- "Uključeno u cenu"
```

## 4.2. DODATNA POLJA/FUNKCIJE SA SVETSKIH PLATFORMI (Udemy, MasterClass, Booksy Education, Preply) — dodati ako nedostaju

- **Ocena i recenzije na nivou pojedinačnog kursa** (ne samo na nivou centra) — polaznik koji je završio kurs ostavlja ocenu i komentar za taj konkretan kurs
- **Profil edukatora/predavača** — posebna kartica/sekcija sa biografijom, iskustvom i portfolijom predavača (ne samo centra kao institucije)
- **Broj dosadašnjih polaznika** ("Kurs završilo 340 polaznika") — socijalni dokaz, prikazuje se na kartici i detaljnoj stranici
- **Video pregled/trailer kursa** — kratak video koji centar može opciono da doda
- **Jezik izvođenja kursa** — polje (srpski/engleski/itd.), bitno za online kurseve
- **Slični/povezani kursevi** — prikaz na dnu detaljne stranice (na osnovu iste potkategorije ili tagova)
- **Lista želja / Sačuvaj kurs za kasnije** — korisnik može da sačuva kurs bez odmah slanja upita
- **FAQ sekcija po kursu** — centar unosi najčešća pitanja i odgovore
- **Politika otkazivanja/povraćaja depozita** — obavezno polje kod kurseva sa depozitom
- **Lista čekanja (waitlist)** — kada su mesta popunjena, korisnik se prijavljuje na listu čekanja za sledeći termin
- **Poklon vaučer za kurs** — mogućnost kupovine kursa kao poklona (opciono, niži prioritet)

Sve gore navedeno je **dopuna**, ne zamena — implementirati kao dodatna, opciona polja koja centar popunjava kroz admin formu za dodavanje/izmenu kursa.

---

## 5. STRUKTURA STRANICA I NAVIGACIJA

```
Edukacije (početna)
 └─ 6 sekcija (kartice sa ikonicom + broj dostupnih kurseva):
     Lice i telo | Nokti i stopala | Oči i obrve | Kosa i stiling | Telo i wellness | Poslovanje i zanat
     └─ Kategorija (npr. Trepavice) — prikaz kao chips/accordion sa potkategorijama
         └─ Potkategorija (npr. Lash Lift) — lista konkretnih kurseva
             └─ Kurs — detaljna stranica
```

- Pretraga (autocomplete, pretražuje kroz sekcije/kategorije/potkategorije/nazive kurseva) — dostupna na svakom nivou, ne samo na početnoj
- Filteri (sidebar ili top-bar), dostupni na svakom nivou hijerarhije: Format (uživo/online/hibridno), Grad/lokacija, Trajanje, Nivo (početni/napredni/profesionalni), Cena (opseg), Akreditacija (neformalna/akreditovan program)

### Redosled sekcija na početnoj stranici "Edukacije" (i na svakoj kategoriji/potkategoriji):

1. **Popularne edukacije** — top-level kategorije, BEZ monetizacije. Prikazuje se SAMO na početnoj stranici Edukacije (ne ponavlja se na nivou kategorije/potkategorije). Računato algoritamski (broj pregleda + broj upita po kategoriji u poslednjih 30 dana).
2. **Istaknuti edukativni centri** — PLAĆENO, max 3-4 slota po nivou stranice, obavezna vizuelna oznaka "Istaknuto". Ponavlja se na početnoj, na nivou svake kategorije i svake potkategorije (slotovi su specifični za taj nivo, ne globalni).
3. **Specijalne ponude** — PLAĆENO, max 3-4 slota po nivou stranice, obavezna vizuelna oznaka "Sponzorisano". Isto ponavljanje kao gore.
4. **Novi edukativni centri na platformi** — BEZ monetizacije, sortirano po datumu pridruživanja (najnoviji prvi).
5. **Najtraženiji edukativni centri** — BEZ monetizacije. Računato po (broj_upita_90d + broj_rezervacija_90d). **Minimalni prag za ulazak na listu (npr. min 10 upita u 90 dana)** da se spreči da nov centar sa slučajnim skokom upita odmah dominira listom.
6. **Najbolje ocenjeni edukativni centri** — BEZ monetizacije. Računato po prosečnoj oceni. **Minimalni prag (npr. min 5 recenzija)** pre ulaska na listu.

### Kartica kursa (u listama):
Slika/thumbnail, naziv kursa, edukativni centar (logo + ime), cena, trajanje, format, lokacija, prosečna ocena.

### Detaljna stranica kursa:
Program kursa (moduli/lekcije), uslovi za pohađanje, info o edukatoru/centru, cena i način plaćanja, vrsta sertifikata i da li je akreditovan, dugme "Pošalji upit" / "Rezerviši mesto" (sa depozitom ako je uživo kurs, ili punom uplatom ako je online), recenzije.

---

## 6. ADMIN PANEL — DODATI

- Upravljanje cenama i brojem slotova za "Istaknuto" i "Specijalne ponude", po nivou stranice (početna/kategorija/potkategorija)
- Pregled i odobravanje predloga novih tipova kurseva/potkategorija koje šalju edukativni centri (dropdown: Sekcija → Kategorija → Potkategorija → postojeći tip ILI "Predloži novi tip", novi ide u status "na_cekanju" dok ga admin ne odobri)
- Dashboard sa metrikama centara (broj upita, pregleda, ocena) radi transparentne provere pre ulaska u organske liste ("najtraženiji"/"najbolje ocenjeni")

## 7. ANTI-GAMING PRAVILA

- Rotacija između centara koji kupe istu poziciju/slot u istom vremenskom periodu (ne "ko prvi plati, zadržava zauvek")
- Obavezna vizuelna oznaka "Sponzorisano"/"Istaknuto" na svim plaćenim stavkama, jasno vizuelno odvojeno od organskih rezultata
- Minimalni pragovi (broj upita, broj recenzija) pre ulaska u organske ("najtraženiji"/"najbolje ocenjeni") liste

---

## 8. NAPOMENA O DODAVANJU KURSEVA (admin/centar flow)

Kada edukativni centar dodaje kurs: kaskadni dropdown Sekcija → Kategorija → Potkategorija → Tip kursa (iz gornje liste). Ako željeni tip kursa ne postoji u listi, centar može poslati predlog novog tipa koji ide administratoru na odobrenje pre nego što postane vidljiv/izabir svima ostalima (sprečava duplikate i haos u taksonomiji).
