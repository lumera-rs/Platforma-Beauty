import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "./layout";
import { useAdminListUsers, useAdminUpdateUser, getAdminListUsersQueryKey, useGetCurrentUser } from "@workspace/api-client-react";
import type { AdminUserUpdateRole, AdminListUsersRole } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Users as UsersIcon, Mail, FilterX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export default function AdminUsers() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 400);
  
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canManageUsers = currentUserResponse?.user?.role === "SUPER_ADMIN";
  
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
                <SelectItem value="EDUCATION_CENTER_OWNER">Vlasnik Edu. Centra</SelectItem>
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
                          <option value="EDUCATION_CENTER_OWNER">Vlasnik Edu. Centra</option>
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
      </div>
    </AdminLayout>
  );
}
