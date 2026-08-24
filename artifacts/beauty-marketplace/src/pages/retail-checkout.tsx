import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { notifyRetailCartChanged } from "@/lib/retail-cart-events";

type Cart = { id: string; items: Array<{ id: string; productId: string; name: string; imageUrl: string; quantity: number; unitPrice: number; lineTotal: number }>; itemCount: number; subtotal: number };
type CheckoutPreview = { cart: Cart; shipping: { shippingCost: number }; total: number };
type Order = { orderNumber: string; status: string; total: number; trackingNumber?: string | null; items: Array<{ id: string; name: string; quantity: number; unitPrice: number }> };
type ChangedCartItem = { name: string; quantity: number | null };

type UnavailableItem = { productId: string; name: string };
const money = (value: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(value);
// Identity/quantity only: the cart endpoint returns stored prices while the quoted
// preview carries live prices, so amounts must stay out of the change fingerprint.
const cartItemsFingerprint = (cart: Cart) =>
  cart.items.map((item) => `${item.id}:${item.productId}:${item.quantity}`).sort().join("|");

class RetailApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly unavailableItems: UnavailableItem[] = [],
  ) {
    super(message);
    this.name = "RetailApiError";
  }
}

async function retail<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: "include", headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown; code?: unknown; unavailableItems?: unknown } | null;
    const unavailableItems = Array.isArray(body?.unavailableItems)
      ? body.unavailableItems.filter((item): item is UnavailableItem =>
        typeof item === "object" && item !== null
        && typeof (item as { productId?: unknown }).productId === "string"
        && typeof (item as { name?: unknown }).name === "string",
      )
      : [];
    throw new RetailApiError(
      typeof body?.error === "string" ? body.error : "Zahtev nije uspeo.",
      response.status,
      typeof body?.code === "string" ? body.code : undefined,
      unavailableItems,
    );
  }
  return response.json() as Promise<T>;
}

function CartLines({ cart, change, remove }: { cart: Cart; change: (item: Cart["items"][number], quantity: number) => void; remove: (item: Cart["items"][number]) => void }) {
  return <div className="space-y-3">{cart.items.map((item) => <div key={item.id} className="flex gap-3 rounded-xl border p-3">
    <img src={item.imageUrl} alt="" className="h-20 w-20 rounded-lg object-cover bg-muted" />
    <div className="min-w-0 flex-1"><p className="font-medium">{item.name}</p><p className="mt-1 text-sm text-muted-foreground">{money(item.unitPrice)}</p>
      <div className="mt-3 flex items-center gap-2"><Button size="icon" variant="outline" className="h-8 w-8" aria-label={`Smanji količinu proizvoda ${item.name}`} onClick={() => item.quantity > 1 ? change(item, item.quantity - 1) : remove(item)}><Minus className="h-3.5 w-3.5" /></Button><span className="w-6 text-center text-sm">{item.quantity}</span><Button size="icon" variant="outline" className="h-8 w-8" aria-label={`Povećaj količinu proizvoda ${item.name}`} onClick={() => change(item, item.quantity + 1)}><Plus className="h-3.5 w-3.5" /></Button>
      <Button size="icon" variant="ghost" className="ml-auto h-8 w-8 text-destructive" aria-label={`Ukloni ${item.name} iz korpe`} onClick={() => remove(item)}><Trash2 className="h-4 w-4" /></Button></div>
    </div><strong>{money(item.lineTotal)}</strong>
  </div>)}</div>;
}

export function RetailCartPage() {
  const { toast } = useToast();
  const [cart, setCart] = useState<Cart | null>(null);
  // Guards against cross-tab polling clobbering an in-progress local edit: while a
  // local mutation (and its follow-up reload) is in flight the poll skips applying,
  // and bumping the generation discards any poll response that started earlier.
  const localOpsRef = useRef(0);
  const generationRef = useRef(0);
  const loadCart = () => retail<Cart>("/retail/cart").then((latest) => { setCart(latest); return latest; }).catch(() => { setCart(null); return null; });
  const runLocalCartOp = async (op: () => Promise<Cart>, failureMessage: string, changedItem: ChangedCartItem) => {
    generationRef.current += 1;
    localOpsRef.current += 1;
    try {
      const latest = await op();
      setCart(latest);
      notifyRetailCartChanged(latest.itemCount, changedItem);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failureMessage);
    } finally {
      localOpsRef.current -= 1;
    }
  };
  const change = (item: Cart["items"][number], quantity: number) => void runLocalCartOp(
    () => retail<Cart>(`/retail/cart/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ quantity }) }),
    "Promena nije uspela.",
    { name: item.name, quantity },
  );
  const remove = (item: Cart["items"][number]) => void runLocalCartOp(
    () => retail<Cart>(`/retail/cart/items/${item.id}`, { method: "DELETE" }),
    "Brisanje nije uspelo.",
    { name: item.name, quantity: null },
  );
  useEffect(() => { void loadCart(); }, []);
  useEffect(() => {
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking || localOpsRef.current > 0) return;
      checking = true;
      const generation = generationRef.current;
      try {
        const latest = await retail<Cart>("/retail/cart");
        if (!active || localOpsRef.current > 0 || generation !== generationRef.current) return;
        setCart((current) =>
          current && cartItemsFingerprint(latest) === cartItemsFingerprint(current) && latest.subtotal === current.subtotal
            ? current
            : latest,
        );
      } catch {
        // Transient poll failures are ignored; the next tick retries.
      } finally {
        checking = false;
      }
    };
    const interval = window.setInterval(() => { void check(); }, 4000);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return <Layout><main className="mx-auto min-h-screen max-w-3xl px-4 py-10"><h1 className="font-serif text-4xl font-bold">Vaša korpa</h1>{!cart ? <Loader2 className="mt-10 animate-spin" /> : !cart.items.length ? <div className="mt-10 rounded-2xl border p-8 text-center"><ShoppingBag className="mx-auto h-10 w-10 text-muted-foreground" /><p className="mt-3">Korpa je prazna.</p><Button asChild className="mt-5"><Link href="/proizvodi">Pregledajte proizvode</Link></Button></div> : <><div className="mt-6"><CartLines cart={cart} change={change} remove={remove} /></div><div className="mt-6 flex items-center justify-between rounded-xl bg-muted p-5"><span className="font-medium">Ukupno</span><strong className="text-xl">{money(cart.subtotal)}</strong></div><Button asChild size="lg" className="mt-5 w-full"><Link href="/korpa/placanje">Nastavi na dostavu i plaćanje</Link></Button></>}</main></Layout>;
}

export function RetailCheckoutPage() {
  const [, setLocation] = useLocation(); const { toast } = useToast();
  const [cart, setCart] = useState<Cart | null>(null); const [preview, setPreview] = useState<CheckoutPreview | null>(null); const [submitting, setSubmitting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [quoteRefreshMessage, setQuoteRefreshMessage] = useState<string | null>(null);
  const [quoteRefreshError, setQuoteRefreshError] = useState<string | null>(null);
  const [unavailableCartItem, setUnavailableCartItem] = useState(false);
  const [unavailableItems, setUnavailableItems] = useState<UnavailableItem[]>([]);
  const [cartChangedElsewhere, setCartChangedElsewhere] = useState(false);
  const [idempotencyKey] = useState(() => `retail-${crypto.randomUUID()}-${crypto.randomUUID()}`);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", street: "", city: "", postalCode: "", note: "", paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier" });
  const cartFingerprint = cart ? cartItemsFingerprint(cart) : null;
  useEffect(() => { void retail<Cart>("/retail/cart").then(setCart).catch(() => setCart(null)); }, []);
  useEffect(() => {
    if (!cart) return;
    const controller = new AbortController();
    let active = true;
    setPreviewLoading(true);
    setPreview(null);
    setQuoteRefreshMessage(null);
    setQuoteRefreshError(null);
    setUnavailableCartItem(false);
    setUnavailableItems([]);
    setCartChangedElsewhere(false);
    if (!cart.items.length) {
      setPreviewLoading(false);
      return () => {
        active = false;
        controller.abort();
      };
    }
    const query = new URLSearchParams({ deliveryMethod: form.deliveryMethod, city: form.city });
    void retail<CheckoutPreview>(`/retail/checkout-preview?${query}`, { signal: controller.signal })
      .then((nextPreview) => {
        if (!active) return;
        setPreview(nextPreview);
        setCart(nextPreview.cart);
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setPreview(null);
        if (error instanceof RetailApiError && error.code === "CHECKOUT_QUOTE_CHANGED") {
          setUnavailableCartItem(true);
          setUnavailableItems(error.unavailableItems);
        } else {
          setQuoteRefreshError(error instanceof Error ? error.message : "Pregled porudžbine nije mogao da se učita.");
        }
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [cart?.id, cartFingerprint, form.deliveryMethod, form.city]);
  useEffect(() => {
    if (form.deliveryMethod === "personal_belgrade" && !/beograd/i.test(form.city)) {
      setForm((current) => ({ ...current, deliveryMethod: "courier" }));
    }
  }, [form.city, form.deliveryMethod]);
  useEffect(() => {
    if (!cart || cartChangedElsewhere) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking || cartChangedElsewhere) return;
      checking = true;
      try {
        const latest = await retail<Cart>("/retail/cart");
        if (!active || cartItemsFingerprint(latest) === cartFingerprint) return;
        if (!latest.items.length) {
          setCart(latest);
          setPreview(null);
          return;
        }
        if (!cart?.items.length) {
          setCart(latest);
          setPreview(null);
          setQuoteRefreshMessage(null);
          setQuoteRefreshError(null);
          setPreviewLoading(true);
          return;
        }
        setCartChangedElsewhere(true);
      } catch {
        // Transient poll failures are ignored; confirmation still revalidates server-side.
      } finally {
        checking = false;
      }
    };
    const interval = window.setInterval(() => { void check(); }, 4000);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cart, cartChangedElsewhere, cartFingerprint]);
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const refreshCheckoutQuote = async (previousPreview: CheckoutPreview | null) => {
    setPreview(null);
    setQuoteRefreshMessage(null);
    setQuoteRefreshError(null);
    setUnavailableCartItem(false);
    setUnavailableItems([]);
    setCartChangedElsewhere(false);
    setPreviewLoading(true);
    try {
      const currentCart = await retail<Cart>("/retail/cart");
      setCart(currentCart);
      if (!currentCart.items.length) return;

      const query = new URLSearchParams({ deliveryMethod: form.deliveryMethod, city: form.city });
      const nextPreview = await retail<CheckoutPreview>(`/retail/checkout-preview?${query}`);
      setCart(nextPreview.cart);
      setPreview(nextPreview);
      const previousShipping = previousPreview?.shipping.shippingCost;
      const previousTotal = previousPreview?.total;
      const shippingChange = previousShipping !== undefined && previousShipping !== nextPreview.shipping.shippingCost
        ? ` (prethodno ${money(previousShipping)})`
        : "";
      const totalChange = previousTotal !== undefined && previousTotal !== nextPreview.total
        ? ` (prethodno ${money(previousTotal)})`
        : "";
      setQuoteRefreshMessage(
        `Pregled je osvežen. Dostava je sada ${money(nextPreview.shipping.shippingCost)}${shippingChange}, a ukupno za plaćanje ${money(nextPreview.total)}${totalChange}.`,
      );
    } catch (error) {
      setPreview(null);
      if (error instanceof RetailApiError && error.code === "CHECKOUT_QUOTE_CHANGED") {
        setUnavailableCartItem(true);
        setUnavailableItems(error.unavailableItems);
      } else {
        setQuoteRefreshError(error instanceof Error ? error.message : "Pregled porudžbine nije mogao da se osveži.");
        toast.error(error instanceof Error ? error.message : "Pregled porudžbine nije mogao da se osveži.");
      }
    } finally {
      setPreviewLoading(false);
    }
  };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!preview || cartChangedElsewhere) return; setSubmitting(true); try {
    const order = await retail<Order & { trackingToken?: string | null }>("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        ...form,
        idempotencyKey,
        expectedSubtotal: preview?.cart.subtotal,
        expectedShippingCost: preview?.shipping.shippingCost,
        expectedTotal: preview?.total,
      }),
    });
    sessionStorage.setItem("retail-order", JSON.stringify(order)); notifyRetailCartChanged(0); setLocation(`/korpa/uspeh?order=${encodeURIComponent(order.orderNumber)}${order.trackingToken ? `&token=${encodeURIComponent(order.trackingToken)}` : ""}`);
  } catch (error) {
    if (error instanceof RetailApiError && error.code === "CHECKOUT_QUOTE_CHANGED") {
      await refreshCheckoutQuote(preview);
    } else {
      toast.error(error instanceof Error ? error.message : "Porudžbina nije potvrđena.");
    }
  } finally { setSubmitting(false); } };
  const personalAvailable = /beograd/i.test(form.city);
  if (cart?.items.length === 0) {
    return <Layout><main className="mx-auto min-h-screen max-w-4xl px-4 py-10"><h1 className="font-serif text-4xl font-bold">Dostava i plaćanje</h1><div className="mt-10 rounded-2xl border p-8 text-center"><ShoppingBag className="mx-auto h-10 w-10 text-muted-foreground" /><p className="mt-3">Korpa je prazna.</p><Button asChild className="mt-5"><Link href="/proizvodi">Pregledajte proizvode</Link></Button></div></main></Layout>;
  }
  if (unavailableCartItem) {
    const productNames = unavailableItems.map((item) => item.name);
    const unavailableMessage = productNames.length === 0
      ? <>Jedan od proizvoda u vašoj korpi je rasprodat ili više nije aktivan. Porudžbina nije kreirana.</>
      : productNames.length === 1
        ? <>Proizvod <strong>{productNames[0]}</strong> je rasprodat ili više nije aktivan. Porudžbina nije kreirana.</>
        : <>Proizvodi <strong>{productNames.join(", ")}</strong> su rasprodati ili više nisu aktivni. Porudžbina nije kreirana.</>;
    const unavailableHeading = productNames.length > 1 ? "Proizvodi više nisu dostupni" : "Proizvod više nije dostupan";
    return <Layout><main className="mx-auto min-h-screen max-w-2xl px-4 py-10"><h1 className="font-serif text-4xl font-bold">Dostava i plaćanje</h1><div data-testid="unavailable-item-recovery" role="alert" aria-live="assertive" className="mt-10 rounded-2xl border border-destructive/30 bg-destructive/5 p-8"><h2 className="text-xl font-semibold">{unavailableHeading}</h2><p className="mt-3 text-muted-foreground">{unavailableMessage}</p><p className="mt-2 text-muted-foreground">Vratite se u korpu da uklonite proizvod ili nastavite sa pregledom drugih proizvoda.</p><div className="mt-6 flex flex-wrap gap-3"><Button variant="outline" asChild><Link href="/korpa">Vrati se u korpu</Link></Button><Button asChild><Link href="/proizvodi">Nastavi sa kupovinom</Link></Button></div></div></main></Layout>;
  }
  return <Layout><main className="mx-auto min-h-screen max-w-4xl px-4 py-10"><h1 className="font-serif text-4xl font-bold">Dostava i plaćanje</h1>{!cart ? <Loader2 className="mt-10 animate-spin" /> : !cart.items.length ? <p className="mt-6">Korpa je prazna.</p> : <form onSubmit={submit} className="mt-7 grid gap-8 lg:grid-cols-[1fr_340px]"><div className="space-y-5"><section className="rounded-xl border p-5"><h2 className="font-semibold">Kontakt</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{[["firstName","Ime"],["lastName","Prezime"],["email","Email"],["phone","Telefon"],["street","Adresa"],["city","Grad"],["postalCode","Poštanski broj"]].map(([key,label]) => <div key={key} className={key === "street" ? "sm:col-span-2" : ""}><Label>{label}</Label><Input required type={key === "email" ? "email" : "text"} value={(form as Record<string,string>)[key]} onChange={(e) => update(key,e.target.value)} /></div>)}</div><div className="mt-3"><Label>Napomena za dostavu</Label><Input value={form.note} onChange={(e) => update("note", e.target.value)} /></div></section><section className="rounded-xl border p-5"><h2 className="font-semibold">Dostava</h2><label className="mt-3 flex gap-2 text-sm"><input type="radio" checked={form.deliveryMethod === "courier"} onChange={() => update("deliveryMethod","courier")} />Kurirska dostava</label><label className="mt-3 flex gap-2 text-sm"><input type="radio" disabled={!personalAvailable} checked={form.deliveryMethod === "personal_belgrade"} onChange={() => update("deliveryMethod","personal_belgrade")} />Lična dostava — Beograd</label>{!personalAvailable && <p className="mt-2 text-xs text-muted-foreground">Unesite Beograd kao grad da biste izabrali ličnu dostavu.</p>}</section><section className="rounded-xl border p-5"><h2 className="font-semibold">Plaćanje</h2>{[["BANK_TRANSFER","Uplata na račun"],["CASH_ON_DELIVERY","Plaćanje pouzećem"]].map(([value,label]) => <label className="mt-3 flex gap-2 text-sm" key={value}><input type="radio" checked={form.paymentMethod === value} onChange={() => update("paymentMethod",value)} />{label}</label>)}<p className="mt-3 text-xs text-muted-foreground">Plaćanje karticom će biti dostupno nakon uključivanja sigurnog payment handoff-a.</p></section></div><aside className="h-fit rounded-xl border p-5"><h2 className="font-semibold">Pregled</h2><p className="mt-4 text-sm text-muted-foreground">{cart.itemCount} stavki</p>{cartChangedElsewhere && <div role="alert" aria-live="assertive" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><p className="font-medium">Korpa je u međuvremenu izmenjena</p><p className="mt-1 text-muted-foreground">Sadržaj korpe je promenjen u drugom tabu ili na drugom uređaju. Osvežite pregled da bi prikazani iznosi odgovarali aktuelnoj korpi.</p><Button type="button" variant="outline" size="sm" className="mt-3" disabled={previewLoading} onClick={() => void refreshCheckoutQuote(preview)}>Osveži pregled</Button></div>}{quoteRefreshMessage && <div role="status" aria-live="polite" className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"><p className="font-medium">Promena iznosa je osvežena</p><p className="mt-1 text-muted-foreground">{quoteRefreshMessage}</p></div>}{quoteRefreshError && <div role="alert" aria-live="assertive" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="font-medium">Pregled nije osvežen</p><p className="mt-1 text-muted-foreground">{quoteRefreshError}</p><Button type="button" variant="outline" size="sm" className="mt-3" disabled={previewLoading} onClick={() => void refreshCheckoutQuote(null)}>Pokušaj ponovo</Button></div>}<div className="mt-3 flex justify-between text-sm"><span>Proizvodi</span><span>{money(cart.subtotal)}</span></div><div className="mt-2 flex justify-between text-sm"><span>Dostava</span><span>{preview ? money(preview.shipping.shippingCost) : "…"}</span></div><div className="mt-3 flex justify-between border-t pt-3"><span className="font-semibold">Ukupno</span><strong className="text-2xl">{preview ? money(preview.total) : "…"}</strong></div><Button className="mt-5 w-full" size="lg" disabled={submitting || previewLoading || !preview || cartChangedElsewhere}>{submitting ? "Potvrđivanje…" : previewLoading ? "Osvežavanje pregleda…" : "Potvrdi porudžbinu"}</Button></aside></form>}</main></Layout>;
}

export function RetailSuccessPage() {
  const [, setLocation] = useLocation(); const query = new URLSearchParams(window.location.search); const order = query.get("order"); const token = query.get("token");
  return <Layout><main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 text-center"><ShoppingBag className="h-12 w-12 text-primary" /><h1 className="mt-5 font-serif text-4xl font-bold">Porudžbina je primljena</h1><p className="mt-3 text-muted-foreground">Broj porudžbine: <strong>{order}</strong>. Poslali smo potvrdu na email adresu.</p>{token && <Button className="mt-6" onClick={() => setLocation(`/porudzbina/pracenje?token=${encodeURIComponent(token)}`)}>Prati porudžbinu</Button>}<Button variant="outline" className="mt-3" asChild><Link href="/proizvodi">Nastavi kupovinu</Link></Button></main></Layout>;
}

export function RetailTrackingPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? ""; const [order, setOrder] = useState<Order | null>(null); const [error, setError] = useState("");
  useEffect(() => { if (token) void retail<Order>(`/retail/orders/track?token=${encodeURIComponent(token)}`).then(setOrder).catch((e) => setError(e.message)); }, [token]);
  return <Layout><main className="mx-auto min-h-screen max-w-2xl px-4 py-10"><h1 className="font-serif text-4xl font-bold">Praćenje porudžbine</h1>{!token || error ? <p className="mt-6 text-destructive">{error || "Veza za praćenje nije važeća."}</p> : !order ? <Loader2 className="mt-8 animate-spin" /> : <div className="mt-7 rounded-xl border p-5"><p className="text-sm text-muted-foreground">{order.orderNumber}</p><h2 className="mt-1 text-xl font-semibold">Status: {order.status}</h2><div className="mt-5 space-y-2">{order.items.map((item) => <p key={item.id}>{item.quantity}× {item.name} — {money(item.unitPrice * item.quantity)}</p>)}</div><strong className="mt-5 block">{money(order.total)}</strong></div>}</main></Layout>;
}
