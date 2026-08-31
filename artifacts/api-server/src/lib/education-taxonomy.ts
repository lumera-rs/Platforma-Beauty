/** Canonical Education taxonomy. Kept in source so production seeding has no runtime prompt-file dependency. */
export type EducationTaxonomySection = {
  name: string;
  categories: Array<{ name: string; groups: Array<{ name: string; items: string }> }>;
};

export const EDUCATION_TAXONOMY: EducationTaxonomySection[] = [
  {
    "name": "LICE I TELO",
    "categories": [
      {
        "name": "KOZMETIČAR I NEGA LICA",
        "groups": [
          {
            "name": "Osnove",
            "items": "Osnovni kurs, Napredni kurs, Estetičar, Anatomija i fiziologija kože, Dermatologija, Kozmetologija (moguć zaseban modul: samo kozmetika lica)"
          },
          {
            "name": "Dijagnostika",
            "items": "Analiza kože, Konsultacija sa klijentom, Prepoznavanje kožnih promena"
          },
          {
            "name": "Čišćenje",
            "items": "Higijenski tretman, dubinsko čišćenje, manualno čišćenje"
          },
          {
            "name": "Po tipu kože",
            "items": "Masna, suva, osetljiva, dehidrirana, problematična, sklona aknama, Mature skin protocols, Sensitive skin protocols"
          },
          {
            "name": "Anti-age/tonus",
            "items": "Anti-age tretmani, hiperpigmentacija, blistavost kože, hidratacija, učvršćivanje kože, facial lifting"
          },
          {
            "name": "Pilinzi",
            "items": "Profesionalni piling, enzimski piling, AHA/BHA kiseline, Dermaplaning"
          },
          {
            "name": "Maske/serumi",
            "items": "Alginatne maske, profesionalne maske i serumi, Facial massage, Spa facial"
          },
          {
            "name": "Korektivno",
            "items": "Camouflage makeup (ožiljci, vitiligo, rozaceja)"
          }
        ]
      },
      {
        "name": "APARATURNI TRETMANI LICA",
        "groups": [
          {
            "name": "Mehanika/vakuum",
            "items": "Mikrodermoabrazija, Hidrodermoabrazija, Hydrofacial/Aqua Peel, Ultrasonic skin scrubber"
          },
          {
            "name": "Struje",
            "items": "Ultrazvuk lica, Sonoforeza, Galvanska struja, Jonoforeza, Elektroporacija, No-needle mezoterapija, EMS/mikrostruje za lice, Microcurrent facial, High Frequency facial"
          },
          {
            "name": "RF/HIFU",
            "items": "Radiofrekvencija lica, Multipolarna RF, Bipolarna RF, HIFU lica"
          },
          {
            "name": "Mikroigličasto",
            "items": "Dermapen, Microneedling, Nano-needling, BB Glow, RF microneedling"
          },
          {
            "name": "Fototerapija",
            "items": "LED fototerapija, Oxygen facial, Oxygen infusion, Cold plasma, Cryo facial"
          },
          {
            "name": "Kombinovanje aparaturnih tretmana",
            "items": "Kombinovanje aparaturnih tretmana"
          }
        ]
      },
      {
        "name": "APARATURNI TRETMANI TELA",
        "groups": [
          {
            "name": "Kavitacija/RF",
            "items": "Kavitacija, Ultrazvučna kavitacija, Radiofrekvencija tela, Vakuum + RF"
          },
          {
            "name": "Limfna/vakuum",
            "items": "Vakuum terapija, Presoterapija, Aparaturna limfna drenaža, LPG/endermologija"
          },
          {
            "name": "Elektrostimulacija",
            "items": "EMS, Elektrostimulacija, HIFEM/Body Sculpt"
          },
          {
            "name": "Termalna",
            "items": "Kriolipoliza, Lipolaser, Infrared body treatments, HIFU tela"
          },
          {
            "name": "Body contouring, Cellulite reduction, Kreiranje body sculpting protokola",
            "items": "Body contouring, Cellulite reduction, Kreiranje body sculpting protokola"
          }
        ]
      },
      {
        "name": "DEPILACIJA I UKLANJANJE DLAKA",
        "groups": [
          {
            "name": "Vosak",
            "items": "Klasična depilacija voskom, topli vosak, hladni vosak, Film/Hard Wax, Soft Wax"
          },
          {
            "name": "Po delu tela",
            "items": "Depilacija lica, depilacija tela, intimna depilacija, brazilska depilacija, muška depilacija"
          },
          {
            "name": "Šećer/threading",
            "items": "Sugaring, šećerna pasta, Threading"
          },
          {
            "name": "Laser/IPL",
            "items": "IPL epilacija, diodni laser, aleksandritni laser, Nd:YAG laser, laserska epilacija, elektroliza/electrolysis"
          }
        ]
      }
    ]
  },
  {
    "name": "NOKTI I STOPALA",
    "categories": [
      {
        "name": "MANIKIR I NOKTI",
        "groups": [
          {
            "name": "Klasične tehnike",
            "items": "Osnovni manikir, klasični, ruski, kombinovani, aparaturni, japanski, spa manikir, E-file tehnika, poravnavanje ploče nokta"
          },
          {
            "name": "Nadogradnja",
            "items": "Gel lak, Rubber base, BIAB/Builder Gel, gel tehnika, akril, Polygel/Acrygel, nadogradnja tipsama, dual forms, korekcija noktiju, profesionalno uklanjanje materijala"
          },
          {
            "name": "Oblici",
            "items": "Nail architecture, salon shapes (Almond, Square, Ballerina, Stiletto), French tehnike, Baby boomer"
          },
          {
            "name": "Nail art",
            "items": "Nail art, 3D nail art, Chrome, Ombre, stamping nail art"
          },
          {
            "name": "Nega",
            "items": "Problematični nokti, parafinska terapija za ruke"
          }
        ]
      },
      {
        "name": "PEDIKIR I PODOLOGIJA",
        "groups": [
          {
            "name": "Klasične tehnike",
            "items": "Klasični pedikir, estetski, spa, aparaturni, kombinovani, pedikir sa gel lakom, parafinska terapija za stopala"
          },
          {
            "name": "Medicinski",
            "items": "Rekonstrukcija nokta, problematična stopala, žuljevi i hiperkeratoza, kurje oko, pukotine na petama, urasli nokti, korektivne tehnike za nokte"
          },
          {
            "name": "Podologija",
            "items": "Ortoniksija, osnove podologije, napredna podologija"
          }
        ]
      }
    ]
  },
  {
    "name": "OČI I OBRVE",
    "categories": [
      {
        "name": "TREPAVICE",
        "groups": [
          {
            "name": "Klasika/volumen",
            "items": "Klasična nadogradnja 1:1, 2D, 3D, 4D-6D, Volume Lashes, Russian Volume, Mega Volume, Hybrid Lashes"
          },
          {
            "name": "Stilske tehnike",
            "items": "Wispy Lashes, Wet Look, Kim K effect, Eyeliner effect, Fox Eye, Cat Eye, Doll Eye, Anime/Manga lashes"
          },
          {
            "name": "Mapiranje/styling",
            "items": "Lash Mapping, Advanced Lash Mapping, Lash Styling"
          },
          {
            "name": "Lift/boja",
            "items": "Lash Lift, Korean Lash Lift, farbanje trepavica, uklanjanje boje"
          },
          {
            "name": "Korekcija/uklanjanje",
            "items": "Korekcija ekstenzija, bezbedno uklanjanje ekstenzija"
          },
          {
            "name": "Lash educator/master program",
            "items": "Lash educator/master program"
          }
        ]
      },
      {
        "name": "OBRVE",
        "groups": [
          {
            "name": "Oblikovanje",
            "items": "Oblikovanje obrva, Brow Mapping, Advanced Brow Mapping, Threading obrva, depilacija obrva"
          },
          {
            "name": "Boja",
            "items": "Farbanje obrva, Henna Brows, Hybrid Dye Brows, Airbrush Brows, uklanjanje boje"
          },
          {
            "name": "Lifting",
            "items": "Brow Lamination, Brow Lift, Brow Styling"
          },
          {
            "name": "Korekcija/asimetrija obrva",
            "items": "Korekcija/asimetrija obrva"
          }
        ]
      },
      {
        "name": "TRAJNA ŠMINKA (PMU)",
        "groups": [
          {
            "name": "Obrve",
            "items": "Osnove PMU, Microblading, Nano Brows, Hair Stroke Brows, Powder Brows, Microshading, Ombre Brows, Shading, Combo Brows, Hybrid Brows"
          },
          {
            "name": "Oči",
            "items": "Permanent Eyeliner, Classic Eyeliner, Shaded Eyeliner, Lash Enhancement"
          },
          {
            "name": "Usne",
            "items": "Permanent Lips, Lip Blush, Aquarelle Lips, Full Lip Colour, neutralizacija tamnih usana"
          },
          {
            "name": "Teorija",
            "items": "Color Theory, Pigmentology, korekcija starog PMU"
          },
          {
            "name": "Uklanjanje",
            "items": "PMU Removal, Saline Removal, Laser PMU Removal, Nano Removal"
          },
          {
            "name": "Specijalizovano",
            "items": "Scalp Micropigmentation, Areola Micropigmentation, Scar Camouflage, Paramedical Tattooing"
          }
        ]
      }
    ]
  },
  {
    "name": "KOSA I STILING",
    "categories": [
      {
        "name": "FRIZER",
        "groups": [
          {
            "name": "Šišanje",
            "items": "Osnovni kurs za frizera, žensko šišanje, muško šišanje, dečje šišanje, napredne tehnike šišanja"
          },
          {
            "name": "Nega kovrdžave kose",
            "items": "Suvo šišanje (dry cut), Curly Girl Method, buđenje kovrča (piling vlasišta + hidratacija), afro i talasasta kosa, dijagnostika tipa kovrdže"
          },
          {
            "name": "Stilizovanje",
            "items": "Feniranje, Blow Dry, stilizovanje kose, lokne, talasi, Hollywood Waves"
          },
          {
            "name": "Svečano/pletenice",
            "items": "Svečane frizure, Bridal Hair, Updo, pletenice, afro pletenice"
          },
          {
            "name": "Ekstenzije/perike",
            "items": "Hair Extensions, Tape-in extensions, Keratin extensions, Microring, Wigs & Hairpieces (uklj. medicinske perike za onkološke pacijente)"
          },
          {
            "name": "Nega/trihologija",
            "items": "Keratinski tretmani, Hair Botox, Hair Reconstruction, Scalp Care, Head Spa, trihologija/dijagnostika opadanja kose"
          },
          {
            "name": "Koloristika osnovna",
            "items": "Osnove koloristike, farbanje, toniranje, bleaching, color correction"
          },
          {
            "name": "Koloristika napredna",
            "items": "Napredna koloristika, Balayage, Ombre, Sombre, Highlights, Babylights, AirTouch, Foilyage, Creative Color"
          }
        ]
      },
      {
        "name": "BARBER",
        "groups": [
          {
            "name": "Šišanje/fade",
            "items": "Osnovni barber kurs, muško šišanje, Fade, Skin Fade, Taper Fade, Scissor Cutting, Clipper Cutting"
          },
          {
            "name": "Brada",
            "items": "Beard Trimming, Beard Styling, Hair & Beard Design"
          },
          {
            "name": "Brijanje",
            "items": "Hot Towel Shave, Classic Shaving, Razor Techniques"
          },
          {
            "name": "Napredno/biznis",
            "items": "Barber Styling, Advanced Barber, Barber Shop Management"
          }
        ]
      },
      {
        "name": "ŠMINKANJE / MAKEUP",
        "groups": [
          {
            "name": "Osnove",
            "items": "Osnovni kurs šminkanja, Self Makeup, Profesionalni Makeup Artist program, Color Theory, Face Shapes & Contouring"
          },
          {
            "name": "Dnevni/večernji",
            "items": "Dnevna šminka, večernja šminka, Glam Makeup, Soft Glam, Smokey Eyes, Cut Crease"
          },
          {
            "name": "Prigodni",
            "items": "Bridal Makeup (+ Bridal Makeup Business), Matursko šminkanje, Dečije/party makeup, Halloween/Carnival makeup"
          },
          {
            "name": "Specijalizovano",
            "items": "Mature Skin Makeup, makeup za problematičnu kožu, makeup za muškarce"
          },
          {
            "name": "Produkcija",
            "items": "Makeup za fotografisanje, Fashion Makeup, Editorial Makeup, TV/Film Makeup, HD Makeup, Airbrush Makeup"
          },
          {
            "name": "SFX/body art",
            "items": "SFX/Special Effects Makeup, Face Painting, Body Painting"
          }
        ]
      },
      {
        "name": "LIČNI STILING I IMIDŽ",
        "groups": [
          {
            "name": "Personal styling / imidž konsultant",
            "items": "Personal styling / imidž konsultant"
          },
          {
            "name": "Analiza tipa figure i boja (color analysis)",
            "items": "Analiza tipa figure i boja (color analysis)"
          },
          {
            "name": "Wardrobe konsalting",
            "items": "Wardrobe konsalting"
          },
          {
            "name": "Styling za fotografisanje/venčanje",
            "items": "Styling za fotografisanje/venčanje"
          }
        ]
      }
    ]
  },
  {
    "name": "TELO I WELLNESS",
    "categories": [
      {
        "name": "MASAŽA",
        "groups": [
          {
            "name": "Klasične/relax",
            "items": "Klasična masaža, Relax masaža, Švedska masaža, Spa masaža"
          },
          {
            "name": "Terapeutsko/sportsko",
            "items": "Terapeutska masaža, Sportska masaža, Sportska rehabilitacija, Kinesio taping, Myofascial tehnike, Trigger point tehnike"
          },
          {
            "name": "Modelovanje tela",
            "items": "Anticelulit masaža, Limfna drenaža, Manuelna limfna drenaža, Maderoterapija, Brazilska maderoterapija, Maderoterapija lica, Vakuum masaža, Cupping masaža, Hot Stone masaža"
          },
          {
            "name": "Orijentalne/tradicionalne",
            "items": "Aromaterapijska masaža, Ayurvedska masaža, Lomi Lomi masaža, Thai masaža, Shiatsu, Bamboo masaža, Masaža biljnim/herbal vrećicama, Tantra/senzualna masaža"
          },
          {
            "name": "Pritisak/refleksne tačke",
            "items": "Akupresura, Refleksologija, Masaža stopala, Masaža glave, Indian Head Massage, Gua Sha masaža"
          },
          {
            "name": "Lice",
            "items": "Masaža lica, Kobido masaža lica, Buccal/intraoralna masaža lica, Sculptural Face Lifting"
          },
          {
            "name": "Posebne grupe",
            "items": "Prenatalna masaža, Postnatalna masaža, Masaža za bebe, Masaža dece, Watsu, Craniosacral tehnike, Prenatalna masaža sa loptom"
          },
          {
            "name": "Vrat/leđa",
            "items": "Masaža vrata i ramena, Masaža leđa"
          }
        ]
      },
      {
        "name": "SPA & WELLNESS",
        "groups": [
          {
            "name": "Spa terapeut",
            "items": "Spa Therapist, Wellness Therapist, Holistic Therapy, Spa Management"
          },
          {
            "name": "Body rituali",
            "items": "Body Scrub, Body Peeling, Body Wrap, Mud Therapy, Chocolate Therapy"
          },
          {
            "name": "Vodeno/toplotno",
            "items": "Hydrotherapy, Thalassotherapy, Marinotherapy, Sauna Rituali, Hammam Treatments, bazenski wellness rituali"
          },
          {
            "name": "Banjska terapija",
            "items": "Balneoterapija, Peloidoterapija (mineralno/mulj)"
          },
          {
            "name": "Napredni wellness aparati",
            "items": "Kriokomora (whole-body cryotherapy), Ozon terapija"
          },
          {
            "name": "Aromatherapy, Herbal Treatments",
            "items": "Aromatherapy, Herbal Treatments"
          },
          {
            "name": "Spa Facial, Spa Massage, detox programi",
            "items": "Spa Facial, Spa Massage, detox programi"
          }
        ]
      },
      {
        "name": "TANNING & BEAUTY SPECIALTIES",
        "groups": [
          {
            "name": "Bronzing",
            "items": "Spray Tan, Airbrush Tan, Professional Self-Tanning, Solarijum (rad sa UV kabinama)"
          },
          {
            "name": "Sitni detalji",
            "items": "Body Makeup, Tooth Gems, Teeth Whitening, Ear Piercing, Beauty Spot/Faux Freckles"
          },
          {
            "name": "Azijski trendovi",
            "items": "Head Spa, Japanese Head Spa, Korean Beauty Treatments, K-Beauty Facial, Glass Skin tretmani"
          }
        ]
      },
      {
        "name": "ALTERNATIVNA I ENERGETSKA WELLNESS TERAPIJA",
        "groups": [
          {
            "name": "Energetske tehnike",
            "items": "Reiki I, Reiki II, Reiki Master, Bioenergija, Kristaloterapija"
          },
          {
            "name": "Zvuk/relaksacija",
            "items": "Sound Healing, Gong terapija, meditacija — vođenje, mindfulness"
          },
          {
            "name": "Rad sa telom/prostorom",
            "items": "Čakra balansiranje, energetsko čišćenje prostora"
          }
        ]
      },
      {
        "name": "INSTRUKTORSKI PROGRAMI POKRETA",
        "groups": [
          {
            "name": "Instruktor joge (osnovni/napredni)",
            "items": "Instruktor joge (osnovni/napredni)"
          },
          {
            "name": "Instruktor pilatesa",
            "items": "Instruktor pilatesa"
          },
          {
            "name": "Instruktor disanja/relaksacije",
            "items": "Instruktor disanja/relaksacije"
          }
        ]
      }
    ]
  },
  {
    "name": "POSLOVANJE I ZANAT",
    "categories": [
      {
        "name": "TETOVAŽA I BODY ART",
        "groups": [
          {
            "name": "Osnove",
            "items": "Osnovni Tattoo Artist, higijena i bezbednost, Tattoo Machine Techniques, Tattoo Design"
          },
          {
            "name": "Stilovi",
            "items": "Fine Line Tattoo, Tiny Tattoo, Blackwork, Linework, Shading, Dotwork, Realism, Micro Realism, Black & Grey, Color Tattoo, Traditional, Neo Traditional, Geometric Tattoo, Lettering"
          },
          {
            "name": "Uklanjanje/korekcija",
            "items": "Tattoo Removal, Scar Camouflage, Stretch Mark Camouflage"
          },
          {
            "name": "Piercing",
            "items": "Ear Piercing, Body Piercing, Microdermal implants, aftercare edukacija"
          }
        ]
      },
      {
        "name": "IZRADA PRIRODNE/ORGANSKE KOZMETIKE",
        "groups": [
          {
            "name": "Osnove formulacije",
            "items": "Kozmetička hemija za početnike, HLB sistem, konzervansi i bezbednost proizvoda"
          },
          {
            "name": "Napredna formulacija",
            "items": "Napredni kurs (za one koji već proizvode), kombinovanje višestrukih formulacija"
          },
          {
            "name": "Kreme i emulzije",
            "items": "Izrada dvofazne/jednofazne kreme, losioni, puteri za telo"
          },
          {
            "name": "Sapuni",
            "items": "Hladan postupak, glicerinski sapuni, ukrašavanje sapuna"
          },
          {
            "name": "Fitokozmetika",
            "items": "Maceracija, melemi, biljna ulja, hidrolati, ekstrakti lekovitog bilja"
          },
          {
            "name": "Aromaterapija (proizvodnja)",
            "items": "Eterična ulja, mešanje mirisa, tonici za lice, dezodoransi"
          },
          {
            "name": "Regulativa i poslovanje",
            "items": "Zakonska regulativa/deklarisanje proizvoda (EU usklađenost), nabavka sirovina, prodaja i marketing sopstvene kozmetike"
          }
        ]
      },
      {
        "name": "BEAUTY BUSINESS & MENADŽMENT",
        "groups": [
          {
            "name": "Pokretanje biznisa",
            "items": "Kako otvoriti beauty salon, Salon Management, Beauty Entrepreneurship, Business Plan"
          },
          {
            "name": "Finansije",
            "items": "Formiranje cena, kalkulacija troškova, profitabilnost tretmana, finansije za beauty salon, osnove knjigovodstva, porezi i administracija"
          },
          {
            "name": "Operativno",
            "items": "Upravljanje zalihama, nabavka proizvoda, upravljanje terminima, Online Booking, No-show management"
          },
          {
            "name": "Kadrovi",
            "items": "Upravljanje zaposlenima, zapošljavanje, motivacija zaposlenih, organizacija smena, SOP procedure"
          },
          {
            "name": "Klijenti",
            "items": "Customer Experience, Customer Service, CRM za beauty salon, retention klijenata, loyalty programi, upselling, cross-selling"
          },
          {
            "name": "Rast",
            "items": "Kreiranje paketa tretmana, membership modeli, KPI za salon, skaliranje salona, otvaranje više lokacija"
          }
        ]
      },
      {
        "name": "MARKETING ZA BEAUTY BIZNIS",
        "groups": [
          {
            "name": "Osnove",
            "items": "Osnove marketinga za beauty, personal branding, branding salona"
          },
          {
            "name": "Društvene mreže",
            "items": "Instagram za beauty salon, TikTok za beauty biznis, Facebook marketing, Reels za beauty salon, TikTok video produkcija"
          },
          {
            "name": "Plaćeno oglašavanje",
            "items": "Meta Ads, Instagram Ads, Google Ads, Google Business Profile"
          },
          {
            "name": "SEO/reputacija",
            "items": "Lokalni SEO, SEO za beauty salon, Google recenzije, Reviews & Reputation Management"
          },
          {
            "name": "Sadržaj",
            "items": "Content Marketing, Content Creation, Canva za beauty biznis, fotografisanje tretmana i Before/After, video editing, copywriting, storytelling"
          },
          {
            "name": "Direktni marketing",
            "items": "Email Marketing, SMS Marketing, CRM Marketing, remarketing, lead generation"
          },
          {
            "name": "Analitika",
            "items": "Marketing automatizacija, analitika i praćenje konverzija"
          }
        ]
      },
      {
        "name": "EDUKATORI / TRAIN THE TRAINER",
        "groups": [
          {
            "name": "Kako postati beauty edukator, Train the Trainer, Teaching Certificate",
            "items": "Kako postati beauty edukator, Train the Trainer, Teaching Certificate"
          },
          {
            "name": "Kreiranje beauty edukacije, metodologija predavanja, praktična demonstracija, rad sa polaznicima",
            "items": "Kreiranje beauty edukacije, metodologija predavanja, praktična demonstracija, rad sa polaznicima"
          },
          {
            "name": "Organizacija praktične nastave, ocena znanja polaznika, mentorstvo",
            "items": "Organizacija praktične nastave, ocena znanja polaznika, mentorstvo"
          },
          {
            "name": "Kreiranje priručnika, prezentacija, online kursa, snimanje online edukacije, prodaja online kurseva",
            "items": "Kreiranje priručnika, prezentacija, online kursa, snimanje online edukacije, prodaja online kurseva"
          },
          {
            "name": "Organizacija masterclass-a, radionica, Personal Branding za edukatore, marketing beauty edukacija, Academy Management",
            "items": "Organizacija masterclass-a, radionica, Personal Branding za edukatore, marketing beauty edukacija, Academy Management"
          }
        ]
      },
      {
        "name": "HIGIJENA, BEZBEDNOST I PROFESIONALNI STANDARDI",
        "groups": [
          {
            "name": "Higijena/sterilizacija",
            "items": "Higijena u beauty salonu, dezinfekcija, sterilizacija, Infection Control, Bloodborne Pathogens"
          },
          {
            "name": "Bezbednost",
            "items": "Bezbednost na radu, profesionalna higijena, prva pomoć"
          },
          {
            "name": "Znanje",
            "items": "Anatomija i fiziologija, dermatologija za beauty profesionalce, kontraindikacije, prepoznavanje reakcija kože, alergijske reakcije, Patch Testing"
          },
          {
            "name": "Bezbednost materijala",
            "items": "Bezbedna upotreba kozmetičkih proizvoda, Chemical Safety, Electrical Safety, bezbednost aparaturnih tretmana"
          },
          {
            "name": "Dokumentacija",
            "items": "Konsultacija sa klijentom, anamneza, Consent Forms, evidencija tretmana, aftercare, profesionalna etika"
          }
        ]
      }
    ]
  }
];

if (EDUCATION_TAXONOMY.length !== 6 || EDUCATION_TAXONOMY.reduce((count, section) => count + section.categories.length, 0) !== 24) {
  throw new Error("Canonical education taxonomy must contain exactly 6 sections and 24 categories");
}
