/**
 * Zaštićeni pristup vodiču za partnere (PDF + JSON sadržaj za in-app prikaz).
 *
 * Dostupno isključivo prijavljenim SALON_OWNER i SALON_EMPLOYEE nalozima.
 * Dokument nije javan: odgovori nose no-store i X-Robots-Tag noindex, i ne
 * postoji javni statički URL koji zaobilazi ovu proveru.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { getCurrentUser } from "../lib/auth";
import { businessGuide } from "../lib/business-guide-content";
import { getBusinessGuidePdf } from "../lib/business-guide-pdf";

const router: IRouter = Router();

const GUIDE_ROLES = new Set(["SALON_OWNER", "EDUKATIVNI_CENTAR", "SALON_EMPLOYEE"]);
const PDF_FILENAME = "LUMERA-vodic-za-partnere.pdf";

async function requireGuideAccess(req: Request, res: Response) {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Prijavite se da biste nastavili." });
    return null;
  }
  if (!GUIDE_ROLES.has(user.role)) {
    res.status(403).json({ error: "Vodič je dostupan samo vlasnicima salona i zaposlenima." });
    return null;
  }
  return user;
}

function setPrivateHeaders(res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

router.get("/business/guide", async (req, res) => {
  const user = await requireGuideAccess(req, res);
  if (!user) return;
  setPrivateHeaders(res);
  res.json(businessGuide);
});

router.get("/business/guide.pdf", async (req, res) => {
  const user = await requireGuideAccess(req, res);
  if (!user) return;
  try {
    const pdf = await getBusinessGuidePdf();
    setPrivateHeaders(res);
    res.setHeader("Content-Type", "application/pdf");
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.setHeader("Content-Disposition", `${disposition}; filename="${PDF_FILENAME}"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.end(pdf);
  } catch (error) {
    req.log?.error({ err: error }, "business guide pdf generation failed");
    res.status(500).json({ error: "Vodič trenutno nije moguće generisati. Pokušajte ponovo." });
  }
});

export default router;
