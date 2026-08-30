import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "./layout";
import { useAdminCreateAccountSetup, useAdminReissueAccountSetup, useAdminListUsers, useAdminUpdateUser, getAdminListUsersQueryKey, useGetCurrentUser } from "@workspace/api-client-react";
import type { AdminCreateAccountSetupInputRole, AdminUserUpdateRole, AdminListUsersRole } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Users as UsersIcon, Mail, FilterX, UserPlus, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function AdminUsers() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const [page, setPage] = useState(1);
  const pageSize = 50;
  // Reset to the first page whenever any filter changes so results stay reachable.
  useEffect(() => { setPage(1); }, [debouncedSearch, roleFilter, activeFilter]);

  const queryParams = {
    search: debouncedSearch || undefined,
    role: roleFilter === "all" ? undefined : (roleFilter as AdminListUsersRole),
    active: activeFilter === "all" ? undefined : activeFilter === "true",
    page,
    pageSize,
  };

  const { data: users, isLoading, error } = useAdminListUsers(queryParams);
  // customFetch returns only the body; infer next-page availability from length.
  const hasNextPage = (users?.length ?? 0) === pageSize;
  const { data: currentUserResponse } = useGetCurrentUser();
  const updateUser = useAdminUpdateUser();
  const createCustomer = useAdminCreateAccountSetup();
  const reissueCustomerSetup = useAdminReissueAccountSetup();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canManageUsers = currentUserResponse?.user?.role === "SUPER_ADMIN";
  const [createOpen, setCreateOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState<{ firstName: string; lastName: string; email: string; role: AdminCreateAccountSetupInputRole }>({ firstName: "", lastName: "", email: "", role: "CUSTOMER" });
  const [setupResult, setSetupResult] = useState<{ setupUrl: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  
  const mutateFnRef = useRef(updateUser.mutate);
  mutateFnRef.current = updateUser.mutate;

  const handleToggleActive = (id: string, currentValue: boolean) => {
    mutateFnRef.current({
      userId: id,
      data: { active: !currentValue }
    }, {
      onSuccess: () => {
        toast.success("Korisnik ažuriran", { description: "Status naloga je promenjen." });
        queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
      },
      onError: () => {
        toast.error("Greška", { description: "Nije moguće ažurirati korisnika." });
      }
    });
  };

  const handleChangeRole = (id: string, newRole: AdminUserUpdateRole) => {
    if (!window.confirm("Da li ste sigurni da želite promeniti ulogu ovog korisnika?")) return;
    
    mutateFnRef.current({
      userId: id,
      data: { role: newRole }
    }, {
      onSuccess: () => {
        toast.success("Uloga promenjena", { description: "Uloga korisnika je uspešno ažurirana." });
        queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
      },
      onError: () => {
        toast.error("Greška", { description: "Nije moguće promeniti ulogu." });
      }
    });
  };

  const handleResetFilters = () => {
    setSearch("");
    setRoleFilter("all");
    setActiveFilter("all");
  };

  const closeCreateDialog = () => {
    setCreateOpen(false);
    setSetupResult(null);
    setCopied(false);
    setCustomerForm({ firstName: "", lastName: "", email: "", role: "CUSTOMER" });
    createCustomer.reset();
    reissueCustomerSetup.reset();
  };

  const handleCreateCustomer = () => {
    if (!window.confirm("Kreirati CUSTOMER nalog i izdati jednokratni link koji važi 15 minuta?")) return;
    createCustomer.mutate({ data: customerForm }, {
      onSuccess: (result) => {
        setSetupResult({ setupUrl: result.setupUrl, expiresAt: result.expiresAt });
        queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
        toast.success("CUSTOMER nalog je kreiran", { description: "Kopirajte setup link pre zatvaranja prozora." });
      },
      onError: () => {
        toast.error("Kreiranje nije uspelo", { description: "Proverite podatke ili da li e-mail već postoji." });
      },
    });
  };

  const copySetupUrl = async () => {
    if (!setupResult) return;
    try {
      await navigator.clipboard.writeText(setupResult.setupUrl);
      setCopied(true);
      toast.success("Setup link je kopiran.");
    } catch {
      toast.error("Kopiranje nije uspelo", { description: "Označite link i kopirajte ga ručno." });
    }
  };

  const handleReissueSetup = (userId: string) => {
    if (!window.confirm("Izdati novi jednokratni link? Prethodni link će odmah biti poništen.")) return;
    reissueCustomerSetup.mutate({ userId }, {
      onSuccess: (result) => {
        setSetupResult({ setupUrl: result.setupUrl, expiresAt: result.expiresAt });
        setCreateOpen(true);
        toast.success("Novi setup link je izdat", { description: "Kopirajte ga pre zatvaranja prozora." });
      },
      onError: () => toast.error("Nije moguće izdati novi link", { description: "Dostupno je samo za aktivan CUSTOMER nalog bez postavljene lozinke." }),
    });
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-serif font-bold text-foreground">Upravljanje Korisnicima</h1>
              <p className="text-muted-foreground text-sm">
                {canManageUsers
                  ? "Pregled i modifikacija svih korisničkih naloga."
                  : "Pregled korisničkih naloga. Promene uloga i statusa dostupne su samo super administratorima."}
              </p>
            </div>
            {canManageUsers && (
              <Button onClick={() => setCreateOpen(true)} data-testid="btn-create-customer">
                <UserPlus className="mr-2 h-4 w-4" />
                Kreiraj nalog
              </Button>
            )}
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-card rounded-xl border shadow-sm">
            <div className="relative md:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Pretraži..." 
                className="pl-9 h-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-search-users"
              />
            </div>
            
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-9" data-testid="select-role-filter">
                <SelectValue placeholder="Sve uloge" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Sve uloge</SelectItem>
                <SelectItem value="CUSTOMER">Klijent</SelectItem>
                <SelectItem value="SALON_OWNER">Vlasnik Salona</SelectItem>
                <SelectItem value="SALON_EMPLOYEE">Zaposleni (Salon)</SelectItem>
                <SelectItem value="EDUKATIVNI_CENTAR">Edukativni centar</SelectItem>
                <SelectItem value="INSTRUCTOR">Instruktor</SelectItem>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
              </SelectContent>
            </Select>

            <Select value={activeFilter} onValueChange={setActiveFilter}>
              <SelectTrigger className="h-9" data-testid="select-active-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Svi statusi</SelectItem>
                <SelectItem value="true">Aktivni</SelectItem>
                <SelectItem value="false">Neaktivni</SelectItem>
              </SelectContent>
            </Select>
            
            <Button variant="outline" className="h-9 w-full" onClick={handleResetFilters} data-testid="btn-reset-filters">
              <FilterX className="w-4 h-4 mr-2" /> Očisti filtere
            </Button>
          </div>
        </div>

        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">Došlo je do greške pri učitavanju korisnika.</div>
          ) : !users || users.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-muted-foreground">
              <UsersIcon className="w-12 h-12 mb-4 opacity-20" />
              <p>Nema pronađenih korisnika za odabrane filtere.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                  <tr>
                    <th className="px-6 py-4">Korisnik</th>
                    <th className="px-6 py-4">Kontakt</th>
                    <th className="px-6 py-4">Uloga</th>
                    <th className="px-6 py-4 text-center">Aktivno</th>
                     <th className="px-6 py-4 text-right">Setup</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {users.map(user => (
                    <tr key={user.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-user-${user.id}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-serif font-bold shrink-0">
                            {user.firstName[0]}{user.lastName[0]}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground">{user.firstName} {user.lastName}</span>
                            <span className="text-xs text-muted-foreground">Pridružio/la se {new Date(user.createdAt).toLocaleDateString('sr-RS')}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1 text-muted-foreground">
                          <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {user.email}</span>
                          {user.phone && <span className="flex items-center gap-1.5 text-xs">{user.phone}</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <select 
                          className="bg-transparent border border-border rounded-md px-2 py-1 text-xs font-medium focus:ring-1 focus:ring-primary outline-none cursor-pointer"
                          value={user.role}
                          onChange={(e) => handleChangeRole(user.id, e.target.value as AdminUserUpdateRole)}
                          disabled={!canManageUsers || updateUser.isPending}
                          aria-label={canManageUsers ? "Promeni ulogu korisnika" : "Samo super administrator može promeniti ulogu"}
                          data-testid={`select-role-${user.id}`}
                        >
                          <option value="CUSTOMER">Klijent</option>
                          <option value="SALON_OWNER">Vlasnik Salona</option>
                          <option value="SALON_EMPLOYEE">Zaposleni (Salon)</option>
                          <option value="EDUKATIVNI_CENTAR">Edukativni centar</option>
                          <option value="INSTRUCTOR">Instruktor</option>
                          <option value="ADMIN">Admin</option>
                          <option value="SUPER_ADMIN">Super Admin</option>
                        </select>
                      </td>
                      <td className="px-6 py-4 text-center align-middle">
                        <div className="flex justify-center">
                          <Switch 
                            checked={user.active} 
                            onCheckedChange={() => handleToggleActive(user.id, user.active)}
                            disabled={!canManageUsers || updateUser.isPending}
                            aria-label={canManageUsers ? "Promeni status korisnika" : "Samo super administrator može promeniti status"}
                            data-testid={`toggle-active-${user.id}`}
                          />
                        </div>
                      </td>
                       <td className="px-6 py-4 text-right">
                         {canManageUsers && user.role !== "SUPER_ADMIN" && user.active && !user.passwordSetAt && (
                           <Button variant="outline" size="sm" disabled={reissueCustomerSetup.isPending} onClick={() => handleReissueSetup(user.id)}>
                             Novi link
                           </Button>
                         )}
                       </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!isLoading && !error && users && users.length > 0 && (
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} data-testid="btn-prev-page">Prethodna</Button>
            <span className="text-sm text-muted-foreground">Strana {page}</span>
            <Button variant="outline" size="sm" disabled={!hasNextPage} onClick={() => setPage(p => p + 1)} data-testid="btn-next-page">Sledeća</Button>
          </div>
        )}

        <Dialog open={createOpen} onOpenChange={(open) => { if (!open) closeCreateDialog(); }}>
          <DialogContent className="w-[calc(100%_-_2rem)] max-w-lg rounded-xl">
            <DialogHeader>
              <DialogTitle>{setupResult ? "Jednokratni setup link" : "Kreiraj nalog"}</DialogTitle>
              <DialogDescription>
                {setupResult
                  ? "Ovaj link se prikazuje samo sada. Bezbedno ga prosledite korisniku i zatim zatvorite prozor."
                  : "Korisnik neće dobiti SMS ili e-mail. Lozinku će sam postaviti preko jednokratnog linka."}
              </DialogDescription>
            </DialogHeader>
            {setupResult ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
                  Link važi do {new Date(setupResult.expiresAt).toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit" })}.
                  Posle zatvaranja ga nije moguće ponovo prikazati.
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input readOnly value={setupResult.setupUrl} onFocus={(event) => event.currentTarget.select()} aria-label="Jednokratni setup link" />
                  <Button type="button" variant="outline" onClick={copySetupUrl} className="shrink-0">
                    {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                    {copied ? "Kopirano" : "Kopiraj"}
                  </Button>
                </div>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); handleCreateCustomer(); }}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input required maxLength={100} placeholder="Ime" value={customerForm.firstName} onChange={(event) => setCustomerForm((value) => ({ ...value, firstName: event.target.value }))} aria-label="Ime" />
                  <Input required maxLength={100} placeholder="Prezime" value={customerForm.lastName} onChange={(event) => setCustomerForm((value) => ({ ...value, lastName: event.target.value }))} aria-label="Prezime" />
                </div>
                <Input required type="email" maxLength={320} placeholder="E-mail adresa" value={customerForm.email} onChange={(event) => setCustomerForm((value) => ({ ...value, email: event.target.value }))} aria-label="E-mail adresa" />
                <Select value={customerForm.role} onValueChange={(role) => setCustomerForm((value) => ({ ...value, role: role as AdminCreateAccountSetupInputRole }))}>
                  <SelectTrigger><SelectValue placeholder="Uloga" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CUSTOMER">Klijent</SelectItem>
                    <SelectItem value="JOBSEEKER">Tražilac posla</SelectItem>
                    <SelectItem value="STUDENT">Student</SelectItem>
                    <SelectItem value="ADMIN">Administrator</SelectItem>
                    <SelectItem value="SALON_OWNER" disabled>Vlasnik salona — potreban salon i poslovni podaci</SelectItem>
                    <SelectItem value="SALON_EMPLOYEE" disabled>Zaposleni — potreban salon i radni profil</SelectItem>
                    <SelectItem value="EDUKATIVNI_CENTAR" disabled>Edukativni centar — potreban profil centra</SelectItem>
                    <SelectItem value="INSTRUCTOR" disabled>Instruktor — potreban profil i centar</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Poslovne uloge zahtevaju povezane domenske podatke i zato se ne mogu kreirati kao nepotpuni nalozi.</p>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={closeCreateDialog}>Otkaži</Button>
                  <Button type="submit" disabled={createCustomer.isPending}>
                    {createCustomer.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Kreiraj i izdaj link
                  </Button>
                </DialogFooter>
              </form>
            )}
            {setupResult && <DialogFooter><Button onClick={closeCreateDialog}>Završi</Button></DialogFooter>}
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
