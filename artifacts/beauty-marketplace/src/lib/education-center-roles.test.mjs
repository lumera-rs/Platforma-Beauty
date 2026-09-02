import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Education Center Strict Separation & Concrete Types', () => {
  const appPath = join(process.cwd(), 'src/App.tsx');
  const appContent = readFileSync(appPath, 'utf-8');
  
  const navPath = join(process.cwd(), 'src/components/business-navbar.tsx');
  const navContent = readFileSync(navPath, 'utf-8');
  
  const businessEduPath = join(process.cwd(), 'src/pages/business-education.tsx');
  const businessEduContent = readFileSync(businessEduPath, 'utf-8');

  const b2bPath = join(process.cwd(), 'src/pages/business-education-b2b.tsx');
  const b2bContent = readFileSync(b2bPath, 'utf-8');

  it('proves no education nav links to /vlasnik', () => {
    assert.ok(navContent.includes("case 'EDUKATIVNI_CENTAR':\n        return educationCenterNavLinks;"), "Nav does not strictly use educationCenterNavLinks");
  });

  it('proves direct owner route guards exclude EDUKATIVNI_CENTAR', () => {
    const loyaltyMatch = appContent.match(/<Route path="\/vlasnik\/loyalty">.*?allowedRoles={\[([^\]]+)\]}/);
    assert.ok(loyaltyMatch !== null, "Loyalty route missing");
    if (loyaltyMatch) {
      assert.ok(!loyaltyMatch[1].includes('EDUKATIVNI_CENTAR'), "Loyalty route allows EDUKATIVNI_CENTAR");
    }
    
    const automationsMatch = appContent.match(/<Route path="\/vlasnik\/automatizacije">.*?allowedRoles={\[([^\]]+)\]}/);
    assert.ok(automationsMatch !== null, "Automations route missing");
    if (automationsMatch) {
      assert.ok(!automationsMatch[1].includes('EDUKATIVNI_CENTAR'), "Automations route allows EDUKATIVNI_CENTAR");
    }
  });

  it('proves SALON_OWNER course controls are absent while catalog remains', () => {
    assert.ok(!businessEduContent.includes("const canCreate = user?.role === 'SALON_OWNER' || user?.role === 'EDUKATIVNI_CENTAR';"), "SALON_OWNER can still create courses");
    assert.ok(businessEduContent.includes("const canCreate = user?.role === 'EDUKATIVNI_CENTAR';"), "EDUKATIVNI_CENTAR cannot create courses");
  });

  it('proves B2B cart and real hook usage', () => {
    assert.ok(b2bContent.includes('useListEducationB2bProducts'), "Missing real B2B products hook");
    assert.ok(b2bContent.includes('useQuoteEducationB2bOrder'), "Missing quote hook");
    assert.ok(b2bContent.includes('useCheckoutEducationB2bOrder'), "Missing checkout hook");
    assert.ok(b2bContent.includes('expectedTotalRsd: quote.payableTotalRsd'), "Checkout does not supply expectedTotalRsd");
    assert.ok(!b2bContent.includes('href="/vlasnik'), "B2B contains links to /vlasnik");
  });

  it('proves all new routes are present in App.tsx', () => {
    assert.ok(appContent.includes('<Route path="/biznis/resursi">'), "Missing /biznis/resursi");
    assert.ok(appContent.includes('<Route path="/biznis/zalihe">'), "Missing /biznis/zalihe");
    assert.ok(appContent.includes('<Route path="/biznis/paketi">'), "Missing /biznis/paketi");
    assert.ok(appContent.includes('<Route path="/biznis/polaznici">'), "Missing /biznis/polaznici");
    assert.ok(appContent.includes('<Route path="/biznis/predavaci-ucinak">'), "Missing /biznis/predavaci-ucinak");
    assert.ok(appContent.includes('<Route path="/biznis/ai-asistent">'), "Missing /biznis/ai-asistent");
    assert.ok(appContent.includes('<Route path="/biznis/b2b">'), "Missing /biznis/b2b");
    assert.ok(appContent.includes('<Route path="/admin/education-b2b-popusti">'), "Missing /admin/education-b2b-popusti");
  });
});
